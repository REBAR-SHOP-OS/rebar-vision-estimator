import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { StageHeader, Pill, EmptyState, GateBanner, type StageProps } from "./_shared";
import {
  ArrowLeft, ArrowRight, Wand2, Filter, Layers, Columns2, GitCompare,
  ZoomIn, ZoomOut, Maximize2, Eye, Edit3, AlertTriangle, RefreshCw, Hand,
  Fingerprint, History, GitBranch, Scale, Edit2, RefreshCw as Sync, Bug,
} from "lucide-react";
import { loadWorkflowQaIssues, type WorkflowQaIssue } from "../takeoff-data";
import { supabase } from "@/integrations/supabase/client";
import PdfRenderer from "@/components/chat/PdfRenderer";
import {
  normalizeBboxToImagePixels,
  type BBox,
} from "./qa-overlay-geometry";
import { buildEngineerAnswerDraft, inferEngineerAnswerFields, summarizeEngineerAnswer } from "./qa-answer-fields";
import { applyEngineerAnswerToEstimateItem, linkedEstimateItemIdFromRefs, type EngineerAnswerRecord } from "./assistant-logic";

type TabKey = "change" | "impact" | "evidence" | "action";

type PageTextItem = { str: string; x: number; y: number; w: number; h: number };
type TextLine = { items: PageTextItem[]; y: number; text: string };

const MIN_ANCHOR_CONFIDENCE = 0.75;
const EMPTY_REFS: string[] = [];
const CLOSED_QA_STATUSES = new Set(["resolved", "closed"]);

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9#./\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampBbox(
  bbox: BBox | null,
  imgW: number,
  imgH: number,
): BBox | null {
  if (!bbox || !imgW || !imgH) return bbox;
  const x1 = Math.max(0, Math.min(imgW, bbox[0]));
  const y1 = Math.max(0, Math.min(imgH, bbox[1]));
  const x2 = Math.max(x1, Math.min(imgW, bbox[2]));
  const y2 = Math.max(y1, Math.min(imgH, bbox[3]));
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
}

function buildTextLines(pageText: PageTextItem[]): TextLine[] {
  const heights = pageText.map((t) => t.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 8;
  const yTol = Math.max(4, medH * 0.6);
  const sorted = [...pageText].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(it.y - last.y) <= yTol) {
      last.items.push(it);
    } else {
      lines.push({ items: [it], y: it.y, text: "" });
    }
  }
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    ln.text = normalizeText(ln.items.map((i) => i.str).join(" "));
  }
  return lines;
}

function findSpanInLine(items: PageTextItem[], needle: string): PageTextItem[] | null {
  const target = normalizeText(needle);
  if (!target) return null;
  const lower = items.map((i) => normalizeText(i.str));
  let best: PageTextItem[] | null = null;
  for (let i = 0; i < lower.length; i++) {
    let acc = "";
    for (let j = i; j < lower.length; j++) {
      acc = normalizeText(`${acc} ${lower[j]}`);
      if (!acc) continue;
      if (acc.includes(target)) {
        const candidate = items.slice(i, j + 1);
        if (!best || candidate.length < best.length) best = candidate;
        break;
      }
    }
  }
  return best;
}

function isLocalizedSpan(items: PageTextItem[], imgW: number, imgH: number): boolean {
  if (!items.length) return false;
  const x1 = Math.min(...items.map((s) => s.x));
  const y1 = Math.min(...items.map((s) => s.y));
  const x2 = Math.max(...items.map((s) => s.x + s.w));
  const y2 = Math.max(...items.map((s) => s.y + s.h));
  const spanW = Math.max(1, x2 - x1);
  const spanH = Math.max(1, y2 - y1);
  const widthOk = !imgW || spanW <= imgW * 0.45;
  const heightOk = !imgH || spanH <= imgH * 0.18;
  const areaOk = !imgW || !imgH || spanW * spanH <= imgW * imgH * 0.12;
  return widthOk && heightOk && areaOk;
}

function getExcerptTokens(value: string | null | undefined): string[] {
  const stop = new Set(["look", "sheet", "page", "find", "enter", "drawing", "from", "note", "typical", "rebar", "bars", "vertical", "cont", "reinforcement"]);
  return Array.from(new Set(
    normalizeText(value)
      .split(" ")
      .filter((tok) => tok && !stop.has(tok) && (tok.length >= 4 || /\d/.test(tok)))
  )).slice(0, 8);
}

function isPageLikeAnchor(value: string | null | undefined): boolean {
  const s = String(value || "").trim();
  return !s || /^(?:p|page)?\s*\d+$/i.test(s);
}

type AnchorKind = "trusted" | "detail" | "section" | "callout" | "grid" | "element" | "schedule" | "excerpt" | "ocr";
function buildAnchorCandidates(sel: WorkflowQaIssue | undefined | null): Array<{ value: string; kind: AnchorKind; score: number }> {
  const loc = sel?.location || {};
  const candidates: Array<{ value: string; kind: AnchorKind; score: number }> = [];
  const push = (value: string | null | undefined, kind: AnchorKind, score: number) => {
    const s = String(value || "").trim();
    if (isPageLikeAnchor(s)) return;
    candidates.push({ value: s, kind, score });
  };
  // 1. TRUSTED anchor emitted by the estimator pipeline. This is the token
  //    the estimator already verified against the OCR for the chosen page,
  //    so we always try it first before any viewer-side inference.
  const trustedText = sel?.locator?.anchor_text || null;
  const trustedConf = Number(sel?.locator?.anchor_confidence ?? 0);
  if (trustedText) push(trustedText, "trusted", Math.max(0.95, trustedConf || 0.95));
  push(loc.detail_reference, "detail", 0.99);
  push(loc.section_reference, "section", 0.98);
  push(loc.callout_tag, "callout", 0.97);
  push(loc.grid_reference, "grid", 0.94);
  push(loc.schedule_row_identity, "schedule", 0.92);
  push(loc.element_reference, "element", 0.91);
  for (const tok of getExcerptTokens(loc.source_excerpt)) push(tok, "excerpt", 0.82);
  const quoted = String(loc.source_excerpt || "").match(/"([^"]{3,60})"/);
  if (quoted?.[1]) push(quoted[1], "ocr", 0.65);
  return candidates.filter((cand, idx, arr) => arr.findIndex((c) => `${c.kind}:${normalizeText(c.value)}` === `${cand.kind}:${normalizeText(cand.value)}`) === idx);
}

function tightBox(
  items: Array<{ x: number; y: number; w: number; h: number }>,
  imgW: number,
  imgH: number,
): BBox | null {
  if (!items || items.length === 0) return null;
  const x1 = Math.min(...items.map((m) => m.x));
  const y1 = Math.min(...items.map((m) => m.y));
  const x2 = Math.max(...items.map((m) => m.x + m.w));
  const y2 = Math.max(...items.map((m) => m.y + m.h));
  const h = Math.max(1, y2 - y1);
  // Tight padding: ~half a line vertically, small horizontal breathing room.
  const padX = Math.max(8, h * 0.6);
  const padY = Math.max(6, h * 0.5);
  const maxW = imgW || Number.POSITIVE_INFINITY;
  const maxH = imgH || Number.POSITIVE_INFINITY;
  return [
    Math.max(0, x1 - padX),
    Math.max(0, y1 - padY),
    Math.min(maxW, x2 + padX),
    Math.min(maxH, y2 + padY),
  ];
}

export default function QAStage({ projectId, state, goToStage }: StageProps) {
  const [issues, setIssues] = useState<WorkflowQaIssue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"pdf" | "image" | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfImg, setPdfImg] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [pdfPage, setPdfPage] = useState(1);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [tab, setTab] = useState<TabKey>("change");
  const [zoomMode, setZoomMode] = useState<"tight" | "full">("tight");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [pan, setPan] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [tool, setTool] = useState<"select" | "pan">("select");
  const panStateRef = useRef<{ startX: number; startY: number; startDx: number; startDy: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [viewMode, setViewMode] = useState<"overlay" | "side" | "diff">("overlay");
  const [changedOnly, setChangedOnly] = useState(true);
  const [debug, setDebug] = useState(false);
  const [answerValues, setAnswerValues] = useState<Record<string, string>>({});
  const [answerText, setAnswerText] = useState("");
  const [answerEdited, setAnswerEdited] = useState(false);
  const [answerSaving, setAnswerSaving] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerSavedAt, setAnswerSavedAt] = useState<number | null>(null);
  const [redrawCount, setRedrawCount] = useState(0);
  const [lastTrigger, setLastTrigger] = useState<string>("init");
  const [renderedPage, setRenderedPage] = useState<number | null>(null);
  const [renderStatus, setRenderStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [renderError, setRenderError] = useState<string | null>(null);
  // Text items extracted from the rendered PDF page (image-pixel space).
  const [pageText, setPageText] = useState<PageTextItem[]>([]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [pageBox, setPageBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const answerBoxRef = useRef<HTMLTextAreaElement | null>(null);

  const bump = (reason: string) => {
    setRedrawCount((c) => c + 1);
    setLastTrigger(reason);
  };

  const updatePageBox = () => {
    const host = canvasRef.current;
    if (!host) return;
    setCanvasSize({ width: host.clientWidth, height: host.clientHeight });
    const img = host.querySelector('img[data-qa-preview="true"]') as HTMLImageElement | null;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const parent = img.parentElement;
    if (!parent) return;
    const scale = Math.min(parent.clientWidth / img.naturalWidth, parent.clientHeight / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    setPageBox({
      left: (parent.clientWidth - width) / 2,
      top: (parent.clientHeight - height) / 2,
      width,
      height,
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await loadWorkflowQaIssues(projectId);
      if (cancelled) return;
      setIssues(data);
      setSelectedId((c) => data.find((i) => i.id === c)?.id || data[0]?.id || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const sel = issues.find((i) => i.id === selectedId);

  useEffect(() => {
    const p = sel?.locator?.page_number;
    if (p && p > 0) setPdfPage(p);
    bump(`select issue ${sel?.id?.slice(0, 8) || "—"} → page ${p || "?"}`);
     
  }, [sel?.id, sel?.locator?.page_number]);

  useEffect(() => { setZoomMode("tight"); setZoomLevel(1); setPan({ dx: 0, dy: 0 }); setTab("change"); }, [sel?.id]);
  // Bug #2 fix: clear the transient "Saved ✓" label after 1.5s so the button
  // re-renders back to "Save Answer" instead of staying stuck.
  useEffect(() => {
    if (!answerSavedAt) return;
    const t = window.setTimeout(() => setAnswerSavedAt(null), 1600);
    return () => window.clearTimeout(t);
  }, [answerSavedAt]);
  useEffect(() => {
    setAnswerError(null);
    setAnswerEdited(false);
    const refs = Array.isArray(sel?.source_refs) ? sel?.source_refs : [];
    const existing = refs.find((ref: any) => ref?.engineer_answer)?.engineer_answer;
    setAnswerValues((existing?.values && typeof existing.values === "object") ? existing.values : {});
    setAnswerText(String(existing?.answer_text || sel?.resolution_note || ""));
  }, [sel?.id, sel?.source_refs]);

  useEffect(() => {
    let cancelled = false;
    const fileId = sel?.source_file_id || sel?.linked_item?.source_file_id || null;
    if (!fileId) {
      setPreviewUrl(null); setPreviewKind(null); setPdfImg(null);
      setPdfPageCount(1); setPreviewName("");
      setImgSize(null); setPageText([]); setRenderedPage(null); setPageBox(null);
      setRenderStatus(sel ? "error" : "idle");
      if (sel) setRenderError("Drawing source is missing for this issue.");
      return;
    }
    // Only reset/refetch when the underlying source file actually changes.
    setPreviewUrl(null); setPreviewKind(null); setPdfImg(null);
    setPdfPageCount(1); setPreviewName("");
    setImgSize(null); setPageText([]); setRenderedPage(null); setRenderError(null); setPageBox(null);
    setRenderStatus("loading");
    setPreviewLoading(true);
    (async () => {
      const { data: file } = await supabase
        .from("project_files")
        .select("file_name,file_path,file_type")
        .eq("id", fileId)
        .maybeSingle();
      if (cancelled || !file?.file_path) {
        setRenderStatus("error");
        setRenderError(`Drawing source is missing for ${file?.file_name || "this issue"}.`);
        setPreviewLoading(false);
        return;
      }
      const { data: signed } = await supabase.storage.from("blueprints").createSignedUrl(file.file_path, 3600);
      if (cancelled) return;
      const url = signed?.signedUrl || null;
      const isPdf = (file.file_path || "").toLowerCase().endsWith(".pdf") || (file.file_type || "").toLowerCase().includes("pdf");
      setPreviewUrl(url);
      setPreviewKind(url ? (isPdf ? "pdf" : "image") : null);
      setPreviewName(file.file_name || "");
      if (!url) {
        setRenderStatus("error");
        setRenderError(`Could not load ${file.file_name || "the source file"}.`);
      } else if (!isPdf) {
        setRenderStatus("loading");
      }
      setPreviewLoading(false);
    })();
    return () => { cancelled = true; };
    // Intentionally only depend on the source file id — switching between
    // issues that share the same drawing must NOT reload the PDF.
     
  }, [sel?.source_file_id, sel?.linked_item?.source_file_id]);

  useEffect(() => {
    if (previewKind !== "pdf" || !previewUrl) return;
    // Keep the last rendered raster visible while the requested page renders.
    // Clearing pdfImg here causes the first/next page to flash blank white.
    if (renderedPage !== null && renderedPage !== pdfPage) {
      setRenderStatus("loading");
      setRenderError(null);
      setPageText([]);
    }
     
  }, [previewKind, previewUrl, pdfPage]);

  useEffect(() => {
    if (previewKind !== "image" || !previewUrl) return;
    setRenderError(null);
    setRenderedPage(null);
    setPageText([]);
    setPageBox(null);
  }, [previewKind, previewUrl]);

  useEffect(() => { bump(`view mode → ${viewMode}`);   }, [viewMode]);
  useEffect(() => { bump(`zoom mode → ${zoomMode}`);   }, [zoomMode]);
  // Note: do NOT bump on pdfImg/zoomLevel changes — extra renders here were
  // causing the overlay/page lifecycle to thrash and the drawing to blink.

  // Recompute the page box only when the rendered raster identity or the
  // image's intrinsic size actually changes. Overlay state (selected issue,
  // zoom, anchor metadata, viewMode) must NOT force a recompute here — the
  // ResizeObserver below handles container resizes for those cases.
  useEffect(() => {
    if (renderStatus !== "ready") return;
    updatePageBox();
    const host = canvasRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updatePageBox());
    ro.observe(host);
    return () => ro.disconnect();
     
  }, [renderStatus, imgSize?.w, imgSize?.h, pdfImg]);

  // Group issues by source sheet for the left navigator
  const sheets = useMemo(() => {
    const m = new Map<string, { key: string; name: string; items: WorkflowQaIssue[] }>();
    for (const it of issues) {
      const key = it.source_file_id || it.sheet_id || "_unlinked";
      const name = it.sheet_id?.toString().slice(0, 18) || it.title || "Unlinked";
      if (!m.has(key)) m.set(key, { key, name, items: [] });
      m.get(key)!.items.push(it);
    }
    return Array.from(m.values());
  }, [issues]);

  const critCount = issues.filter((i) => ["critical", "error"].includes(i.severity?.toLowerCase())).length;
  const warnCount = issues.filter((i) => i.severity?.toLowerCase() === "warning").length;
  const totalImpact = issues.length;
  const staleOutputs = issues.filter((i) => ["critical", "error"].includes(i.severity?.toLowerCase())).length;

  const visibleSheets = changedOnly ? sheets.filter((s) => s.items.length > 0) : sheets;
  const missingRefs = sel?.linked_item?.missing_refs || EMPTY_REFS;
  const answerFieldContext = `${sel?.title || ""}\n${sel?.description || ""}\n${sel?.location?.source_excerpt || ""}`;
  const answerFields = useMemo(
    () => inferEngineerAnswerFields(missingRefs, answerFieldContext),
    [missingRefs, answerFieldContext],
  );
  const objectIdentity = [
    sel?.location?.element_reference,
    sel?.location?.element_id,
    sel?.location?.pad_id,
    sel?.location?.footing_id,
    sel?.location?.wall_id,
    sel?.location?.slab_zone_id,
    sel?.location?.callout_tag,
    sel?.location?.detail_reference,
    sel?.location?.grid_reference,
  ].find(Boolean);
  const engineerDraft = useMemo(() => buildEngineerAnswerDraft({
    locationLabel: sel?.location_label,
    pageNumber: sel?.locator?.page_number ?? sel?.location?.page_number ?? null,
    objectIdentity: objectIdentity ? String(objectIdentity) : null,
    description: sel?.description,
    title: sel?.title,
    sourceExcerpt: sel?.location?.source_excerpt,
    missingRefs,
    linearGeometry: Array.isArray(sel?.source_refs) ? (sel?.source_refs?.[0] as any)?.linear_geometry : null,
    wallGeometry: Array.isArray(sel?.source_refs) ? (sel?.source_refs?.[0] as any)?.wall_geometry : null,
  }), [missingRefs, objectIdentity, sel?.description, sel?.location?.page_number, sel?.location?.source_excerpt, sel?.location_label, sel?.locator?.page_number, sel?.source_refs, sel?.title]);
  const engineerQuestion = engineerDraft.question;
  const isWireDrawingIssue = useMemo(() => {
    if (!sel) return false;
    const issueText = [
      sel.title,
      sel.description,
      sel.location?.source_excerpt,
      engineerQuestion,
    ].filter(Boolean).join("\n").toLowerCase();
    const looksDrawingDriven = /enter .* from the drawing|what .* should be used|confirm .* dimensions|drawing note already defines|found drawing callout/.test(issueText);
    return engineerDraft.needsConfirmation && (missingRefs.length > 0 || looksDrawingDriven);
  }, [engineerDraft.needsConfirmation, engineerQuestion, missingRefs.length, sel?.description, sel?.location?.source_excerpt, sel?.title]);

  useEffect(() => {
    if (!sel || answerEdited) return;
    const refs = Array.isArray(sel.source_refs) ? sel.source_refs : [];
    const existing = refs.find((ref: any) => ref?.engineer_answer)?.engineer_answer;
    const hasSavedAnswer = Boolean(String(existing?.answer_text || sel.resolution_note || "").trim());
    if (!hasSavedAnswer && !answerText.trim() && engineerDraft.draftAnswer) {
      setAnswerText(engineerDraft.draftAnswer);
    }
    if (Object.keys(engineerDraft.structuredValues).length > 0) {
      setAnswerValues((current) => {
        const next = { ...current };
        let changed = false;
        for (const [key, value] of Object.entries(engineerDraft.structuredValues)) {
          if (!String(next[key] || "").trim()) {
            next[key] = value;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }
  }, [answerEdited, answerText, engineerDraft, sel]);

  const openAnswerTab = () => {
    setTab("action");
    window.setTimeout(() => answerBoxRef.current?.focus(), 0);
  };

  const updateSelectedIssue = (patch: Partial<WorkflowQaIssue>) => {
    if (!sel) return;
    const nextStatus = String(patch.status || "").toLowerCase();
    if (CLOSED_QA_STATUSES.has(nextStatus)) {
      const currentIndex = issues.findIndex((issue) => issue.id === sel.id);
      const remaining = issues.filter((issue) => issue.id !== sel.id);
      const nextIssue = remaining.length === 0
        ? null
        : remaining[Math.min(Math.max(currentIndex, 0), remaining.length - 1)] || null;
      setIssues(remaining);
      setSelectedId(nextIssue?.id || null);
      // Bug #3 fix: keep the engineer on the Action tab so consecutive
      // resolves don't bounce them back to "Change" between every issue.
      return;
    }
    setIssues((current) => current.map((issue) => issue.id === sel.id ? { ...issue, ...patch } : issue));
  };

  const persistIssueStatus = async (status: string, note: string, values: Record<string, string> = answerValues, text = answerText) => {
    if (!sel) return;
    setAnswerSaving(true);
    setAnswerError(null);
    const now = new Date().toISOString();
    const refs = Array.isArray(sel.source_refs) ? [...sel.source_refs] : [];
    const engineerAnswer: EngineerAnswerRecord = {
      values,
      answer_text: text,
      note,
      status,
      answered_at: now,
      location_label: sel.location_label || null,
      issue_id: sel.id,
      source: "workflow_v2_qa",
    };
    const nextRefs = refs.filter((ref: any) => !ref?.engineer_answer);

    try {
      const linkedEstimateItemId = sel.linked_item?.id || linkedEstimateItemIdFromRefs(refs);
      const itemResult = await applyEngineerAnswerToEstimateItem(supabase, {
        estimateItemId: linkedEstimateItemId,
        responseText: text,
        structuredValues: values,
        requestedStatus: status,
        engineerAnswer,
      });
      // Honour the engineer's explicit decision. Append a takeoff caveat to the note
      // when geometry is still partial, but do NOT downgrade the requested status.
      const effectiveStatus = status;
      const effectiveNote = status === "resolved" && itemResult.updated && itemResult.geometryStatus !== "resolved"
        ? `${note}\n\nNote: takeoff geometry remains ${itemResult.geometryStatus} (quantity/length/weight not all proven).`
        : note;
      nextRefs.push({
        engineer_answer: {
          ...engineerAnswer,
          note: effectiveNote,
          status: effectiveStatus,
          estimate_item_update: itemResult,
        },
      });
      if (sel.id.startsWith("legacy:")) {
        const { error } = await supabase
          .from("validation_issues")
          .update({ status: effectiveStatus, resolution_note: effectiveNote, source_refs: nextRefs, updated_at: now })
          .eq("id", sel.id.replace(/^legacy:/, ""));
        if (error) throw error;
      }
      const linkedPatch = itemResult.updated && sel.linked_item ? {
        linked_item: {
          ...sel.linked_item,
          bar_size: itemResult.values.barSize || sel.linked_item.bar_size,
          quantity_count: itemResult.values.quantity || sel.linked_item.quantity_count,
          total_length: itemResult.values.totalLengthM || sel.linked_item.total_length,
          total_weight: itemResult.values.weightKg || sel.linked_item.total_weight,
          missing_refs: itemResult.geometryStatus === "resolved" ? [] : sel.linked_item.missing_refs,
        },
      } : {};
      updateSelectedIssue({ status: effectiveStatus, resolution_note: effectiveNote, source_refs: nextRefs, ...linkedPatch });
      setAnswerSavedAt(Date.now());
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : "Could not save engineer answer.");
    } finally {
      setAnswerSaving(false);
    }
  };

  const saveEngineerAnswer = async (status = "answered") => {
    const structured = summarizeEngineerAnswer(answerValues);
    const note = answerText.trim() || structured;
    await persistIssueStatus(status, note, answerValues, answerText.trim() || note);
  };

  const jumpToTakeoff = () => {
    goToStage("takeoff");
  };

  const selIndex = issues.findIndex((i) => i.id === selectedId);
  const prevIssue = selIndex > 0 ? issues[selIndex - 1] : null;
  const nextIssue = selIndex >= 0 && selIndex < issues.length - 1 ? issues[selIndex + 1] : null;

  const anchorCandidates = useMemo(() => buildAnchorCandidates(sel), [sel]);
  const textLines = useMemo(() => buildTextLines(pageText), [pageText]);
  const textSearch = useMemo(() => {
    if (!sel || !pageText.length || !imgSize) return null;
    for (const cand of anchorCandidates) {
      for (const ln of textLines) {
        if (!ln.text.includes(normalizeText(cand.value))) continue;
        const span = findSpanInLine(ln.items, cand.value);
        if (span && isLocalizedSpan(span, imgSize.w, imgSize.h)) {
          return {
            bbox: clampBbox(tightBox(span, imgSize.w, imgSize.h), imgSize.w, imgSize.h),
            kind: cand.kind,
            score: cand.score,
            text: cand.value,
          };
        }
      }
    }
    return null;
  }, [sel, pageText, imgSize, anchorCandidates, textLines]);

  const bbox = useMemo(() => {
    if (sel?.locator?.bbox && imgSize) {
      const sourceW = sel.locator.image_size?.w || imgSize.w;
      const sourceH = sel.locator.image_size?.h || imgSize.h;
      const normalized = normalizeBboxToImagePixels(sel.locator.bbox, sourceW, sourceH);
      if (normalized.bbox) {
        const scaled: BBox = sourceW !== imgSize.w || sourceH !== imgSize.h
          ? [
              normalized.bbox[0] * (imgSize.w / sourceW),
              normalized.bbox[1] * (imgSize.h / sourceH),
              normalized.bbox[2] * (imgSize.w / sourceW),
              normalized.bbox[3] * (imgSize.h / sourceH),
            ]
          : normalized.bbox;
        const clamped = clampBbox(scaled, imgSize.w, imgSize.h);
        if (clamped) return clamped;
      }
    }
    return textSearch?.bbox || null;
  }, [sel?.locator?.bbox, sel?.locator?.image_size, textSearch, imgSize]);

  const anchorStatus = sel?.locator?.anchor_mode || (textSearch ? (textSearch.score >= MIN_ANCHOR_CONFIDENCE ? "exact" : "approximate") : "unavailable");
  const anchorReason = textSearch?.text ? `Matched ${textSearch.kind} anchor: ${textSearch.text}` : null;
  const canShowPointer = Boolean(renderStatus === "ready" && previewUrl && imgSize && bbox);

  const TABS: Array<{ k: TabKey; label: string }> = [
    { k: "change", label: "Change" },
    { k: "impact", label: "Impact" },
    { k: "evidence", label: "Evidence" },
    { k: "action", label: "Action" },
  ];

  return (
    <div className="h-full bg-background text-foreground">
      <StageHeader kicker="Stage 04" title="QA Gate" subtitle="Compare revisions, validate anchors, and clear estimator questions" />
      <GateBanner
        tone={critCount > 0 ? "blocked" : "warn"}
        title={critCount > 0 ? "Critical QA issues require action" : warnCount > 0 ? "QA warnings remain open" : "No open QA blockers"}
      />
      <div className="grid grid-cols-4 gap-4 border-b border-border bg-card px-4 py-3 text-[11px] uppercase tracking-[0.14em]">
        <div>Rows Require Action <span className="block text-[18px] font-black tracking-normal text-foreground">{totalImpact}</span></div>
        <div>Warnings <span className="block text-[18px] font-black tracking-normal text-[hsl(var(--status-inferred))]">{warnCount}</span></div>
        <div>Critical <span className="block text-[18px] font-black tracking-normal text-[hsl(var(--status-blocked))]">{critCount}</span></div>
        <div>Outputs Stale <span className="block text-[18px] font-black tracking-normal text-foreground">{staleOutputs}</span></div>
      </div>

      <div className="grid grid-cols-12 h-[calc(100%-112px)] min-h-0">
        <aside className="col-span-2 border-r border-border bg-card/70 min-h-0 flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Source Sheets</div>
            <button onClick={() => setChangedOnly((v) => !v)} className={`px-2 py-1 border text-[9px] uppercase tracking-[0.12em] ${changedOnly ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>{changedOnly ? "Changed" : "All"}</button>
          </div>
          <div className="flex-1 overflow-auto divide-y divide-border">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading QA issues…</div>
            ) : visibleSheets.length === 0 ? (
              <EmptyState title="No QA issues" />
            ) : visibleSheets.map((sheet) => (
              <div key={sheet.key} className="p-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">{sheet.name}</div>
                <div className="space-y-1">
                  {sheet.items.map((issue) => {
                    const active = issue.id === selectedId;
                    return (
                      <button
                        key={issue.id}
                        onClick={() => setSelectedId(issue.id)}
                        className={`w-full text-left px-2 py-2 border ${active ? "border-primary bg-primary/5" : "border-border bg-background/40 hover:bg-accent/30"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-medium truncate">{issue.location_label || issue.title}</div>
                          <Pill tone={["critical", "error"].includes(issue.severity?.toLowerCase()) ? "blocked" : "inferred"}>{issue.severity || "open"}</Pill>
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate mt-1">{issue.description || issue.issue_type}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="col-span-7 min-h-0 flex flex-col bg-background">
          <div className="h-11 border-b border-border flex items-center justify-between px-3 gap-2 bg-card/50">
            <div className="flex items-center gap-2 min-w-0">
              <button disabled={!prevIssue} onClick={() => prevIssue && setSelectedId(prevIssue.id)} className="p-2 border border-border hover:bg-accent/40 disabled:opacity-40"><ArrowLeft className="w-4 h-4" /></button>
              <button disabled={!nextIssue} onClick={() => nextIssue && setSelectedId(nextIssue.id)} className="p-2 border border-border hover:bg-accent/40 disabled:opacity-40"><ArrowRight className="w-4 h-4" /></button>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Focused issue</div>
                <div className="text-[12px] font-bold truncate">{sel?.location_label || sel?.title || "No issue selected"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setViewMode("overlay")} className={`p-2 border ${viewMode === "overlay" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}><Layers className="w-4 h-4" /></button>
              <button onClick={() => setViewMode("side")} className={`p-2 border ${viewMode === "side" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}><Columns2 className="w-4 h-4" /></button>
              <button onClick={() => setViewMode("diff")} className={`p-2 border ${viewMode === "diff" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}><GitBranch className="w-4 h-4" /></button>
              <button onClick={() => setZoomLevel((z) => Math.min(4, z + 0.1))} className="p-2 border border-border hover:bg-accent/40"><ZoomIn className="w-4 h-4" /></button>
              <button onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.1))} className="p-2 border border-border hover:bg-accent/40"><ZoomOut className="w-4 h-4" /></button>
              <button onClick={() => setTool((t) => t === "pan" ? "select" : "pan")} className={`p-2 border ${tool === "pan" ? "border-primary text-primary" : "border-border text-muted-foreground"}`} title="Pan / hand tool"><Hand className="w-4 h-4" /></button>
              <button onClick={() => { setZoomLevel(1); setPan({ dx: 0, dy: 0 }); setZoomMode((m) => m === "tight" ? "full" : "tight"); }} className={`p-2 border ${zoomMode === "tight" ? "border-primary text-primary" : "border-border text-muted-foreground"}`} title="Reset & toggle fit"><Maximize2 className="w-4 h-4" /></button>
              <button onClick={() => setDebug((v) => !v)} className={`p-2 border ${debug ? "border-primary text-primary" : "border-border text-muted-foreground"}`}><Bug className="w-4 h-4" /></button>
            </div>
          </div>

          <div
            ref={canvasRef}
            className="relative flex-1 min-h-0 overflow-hidden bg-[#101216]"
            style={{ cursor: tool === "pan" ? (isPanning ? "grabbing" : "grab") : "default" }}
            onMouseDown={(e) => {
              if (tool !== "pan" && e.button !== 1) return;
              e.preventDefault();
              panStateRef.current = { startX: e.clientX, startY: e.clientY, startDx: pan.dx, startDy: pan.dy };
              setIsPanning(true);
            }}
            onMouseMove={(e) => {
              const s = panStateRef.current;
              if (!s) return;
              setPan({ dx: s.startDx + (e.clientX - s.startX), dy: s.startDy + (e.clientY - s.startY) });
            }}
            onMouseUp={() => { panStateRef.current = null; setIsPanning(false); }}
            onMouseLeave={() => { panStateRef.current = null; setIsPanning(false); }}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              setZoomLevel((z) => Math.max(0.5, Math.min(4, z + (e.deltaY < 0 ? 0.1 : -0.1))));
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: `translate(${pan.dx}px, ${pan.dy}px) scale(${zoomLevel})`,
                transformOrigin: "center center",
                transition: isPanning ? "none" : "transform 120ms ease-out",
                willChange: "transform",
              }}
            >
            {!previewUrl ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">{previewLoading ? "Loading drawing…" : renderError || "Select an issue to load the source drawing."}</div>
            ) : previewKind === "pdf" ? (
              <>
                <PdfRenderer
                  key={`${previewUrl}:${pdfPage}`}
                  file={previewUrl}
                  page={pdfPage}
                  onRender={({ imageUrl, width, height, pageCount, pageNumber, textItems }) => {
                    setPdfImg(imageUrl);
                    setImgSize({ w: width, h: height });
                    setPdfPageCount(pageCount || 1);
                    if (pageNumber && pageNumber !== pdfPage) setPdfPage(pageNumber);
                    setRenderedPage(pageNumber || pdfPage);
                    setPageText(textItems || []);
                    setRenderStatus("ready");
                    setRenderError(null);
                  }}
                  onError={(message) => {
                    setRenderStatus("error");
                    setRenderError(message);
                  }}
                />
                {pdfImg && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative" style={{ display: "inline-block", maxWidth: "100%", maxHeight: "100%" }}>
                      <img
                        data-qa-preview="true"
                        src={pdfImg}
                        alt={previewName || `PDF page ${pdfPage}`}
                        className="block max-w-full max-h-full object-contain"
                        onLoad={(event) => {
                          const img = event.currentTarget;
                          setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
                          setRenderStatus("ready");
                          setRenderError(null);
                          updatePageBox();
                        }}
                        onError={() => {
                          setRenderStatus("error");
                          setRenderError(`Could not render ${previewName || "the source file"}.`);
                        }}
                      />
                      {canShowPointer && bbox && imgSize && (
                        <BBoxPointer
                          bbox={bbox}
                          imgW={imgSize.w}
                          imgH={imgSize.h}
                          viewZoom={zoomLevel}
                          title={sel?.location_label || sel?.title || "Selected target"}
                          onFix={openAnswerTab}
                          approximate={anchorStatus === "approximate"}
                        />
                      )}
                      {debug && imgSize && textLines.map((line, idx) => (
                        <div
                          key={idx}
                          className="absolute left-0 right-0 border-t border-amber-500/20 pointer-events-none"
                          style={{ top: `${(line.y / imgSize.h) * 100}%` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative" style={{ display: "inline-block", maxWidth: "100%", maxHeight: "100%" }}>
                  <img
                    data-qa-preview="true"
                    src={previewUrl}
                    alt={previewName || "Drawing preview"}
                    className="block max-w-full max-h-full object-contain"
                    onLoad={(event) => {
                      const img = event.currentTarget;
                      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
                      setRenderStatus("ready");
                      setRenderError(null);
                      updatePageBox();
                    }}
                    onError={() => {
                      setRenderStatus("error");
                      setRenderError(`Could not render ${previewName || "the source file"}.`);
                    }}
                  />
                  {canShowPointer && bbox && imgSize && (
                    <BBoxPointer
                      bbox={bbox}
                      imgW={imgSize.w}
                      imgH={imgSize.h}
                      viewZoom={zoomLevel}
                      title={sel?.location_label || sel?.title || "Selected target"}
                      onFix={openAnswerTab}
                      approximate={anchorStatus === "approximate"}
                    />
                  )}
                  {debug && imgSize && textLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="absolute left-0 right-0 border-t border-amber-500/20 pointer-events-none"
                      style={{ top: `${(line.y / imgSize.h) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            )}
            </div>

            {renderStatus === "ready" && previewUrl && imgSize && pageBox && (
              <>
                {anchorStatus === "unavailable" && renderStatus === "ready" && previewUrl && (
                  <div className="absolute top-14 right-4 z-10 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--status-blocked))] border border-[hsl(var(--status-blocked))]/40 bg-[hsl(var(--status-blocked))]/10 px-2 py-1">
                    Page linked · no trusted object box on this page
                  </div>
                )}
                {anchorStatus === "approximate" && renderStatus === "ready" && previewUrl && (
                  <div className="absolute top-14 right-4 z-10 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--status-inferred))] border border-[hsl(var(--status-inferred))]/40 bg-[hsl(var(--status-inferred))]/10 px-2 py-1">
                    Approximate anchor · review source excerpt before measuring
                  </div>
                )}
                {canShowPointer && bbox && (
                  <div className="absolute right-4 bottom-4 z-30 pointer-events-auto border border-border bg-card/95 shadow-2xl px-2 py-2 flex items-center gap-2">
                    <div className="min-w-0 pr-1">
                      <div className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Selected target</div>
                      <div className="text-[11px] font-bold text-foreground truncate max-w-[180px]">{sel.location_label || sel.title}</div>
                    </div>
                    {isWireDrawingIssue ? (
                      <>
                        <button onClick={() => setTab("change")} className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] hover:opacity-90 ${tab === "change" ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground"}`}>Change</button>
                        <button onClick={openAnswerTab} className={`px-3 py-1.5 border border-border text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-accent/40 ${tab === "action" ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground"}`}>Action</button>
                      </>
                    ) : (
                      <>
                        <button onClick={openAnswerTab} className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] hover:opacity-90 ${tab === "action" ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground"}`}>Answer</button>
                        <button onClick={() => setTab("impact")} className={`px-3 py-1.5 border border-border text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-accent/40 ${tab === "impact" ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground"}`}>Impact</button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Status rail */}
          <footer className="h-6 bg-card border-t border-border flex items-center px-3 justify-between text-[10px] text-muted-foreground">
            <div className="flex gap-4 items-center">
              <span className="flex items-center gap-1"><Fingerprint className="w-3 h-3" /> Object ID: <span className="text-foreground font-mono">{(sel?.linked_item?.id || sel?.id || "—").slice(0, 12)}</span></span>
              <span className="flex items-center gap-1"><History className="w-3 h-3" /> Active Revisions: <span className="text-foreground">Rev 2, Rev 3</span></span>
            </div>
            <div className="flex items-center gap-3">
              {previewKind === "pdf" && pdfPageCount > 1 && (
                <span className="flex items-center gap-1 font-mono">
                  <button className="px-1 hover:text-foreground" disabled={pdfPage <= 1} onClick={() => setPdfPage((p) => Math.max(1, p - 1))}>◀</button>
                  p{pdfPage}/{pdfPageCount}
                  <button className="px-1 hover:text-foreground" disabled={pdfPage >= pdfPageCount} onClick={() => setPdfPage((p) => Math.min(pdfPageCount, p + 1))}>▶</button>
                </span>
              )}
              <span>Zoom: {Math.round(zoomLevel * 100)}%</span>
              <span className="truncate max-w-[200px]">{previewName || "—"}</span>
              <span className="w-1.5 h-1.5 bg-[hsl(var(--status-supported))] rounded-full" />
            </div>
          </footer>
        </main>

        {/* RIGHT — Compare Inspector */}
        <aside className="col-span-3 bg-card border-l border-border flex flex-col min-h-0">
          <div className="flex border-b border-border bg-background/40">
            {TABS.map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${tab === t.k ? "text-primary border-b-2 border-primary bg-card" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-5">
            {!sel ? <EmptyState title="No issue selected" /> : (
              <>
                {tab === "change" && (
                  <>
                    <section>
                      <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.12em] mb-2 flex items-center gap-1.5">
                        <GitCompare className="w-3.5 h-3.5" /> Geometric Comparison
                      </h3>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="bg-background/60 p-3 border border-border">
                          <p className="text-[9px] text-muted-foreground mb-1 font-bold uppercase">Rev 2 (Old)</p>
                          <p className="text-[13px] font-bold text-[hsl(var(--status-blocked))]">{sel.linked_item?.bar_size ? `${sel.linked_item.quantity_count}x ${sel.linked_item.bar_size}` : "—"}</p>
                          <p className="text-[10px] text-muted-foreground mt-1.5">Length: {sel.linked_item?.total_length ? `${sel.linked_item.total_length}mm` : "—"}</p>
                        </div>
                        <div className="bg-background/60 p-3 border border-primary/40">
                          <p className="text-[9px] text-primary mb-1 font-bold uppercase">Rev 3 (New)</p>
                          <p className="text-[13px] font-bold text-primary">{sel.linked_item?.bar_size ? `${sel.linked_item.quantity_count}x ${sel.linked_item.bar_size}` : "—"}</p>
                          <p className="text-[10px] text-muted-foreground mt-1.5">Length: {sel.linked_item?.total_length ? `${sel.linked_item.total_length}mm` : "—"}</p>
                        </div>
                      </div>
                    </section>
                    <section>
                      <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.12em] mb-2">Issue</h3>
                      <div className="bg-background/60 p-3 border border-border space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-mono">{sel.id.slice(0, 16).toUpperCase()}</span>
                          <Pill tone={["critical", "error"].includes(sel.severity?.toLowerCase()) ? "blocked" : "inferred"} solid>{sel.severity?.toUpperCase() || "-"}</Pill>
                        </div>
                        <div className="text-[12px] font-medium">{sel.title}</div>
                        {sel.location_label && (
                          <div className="border-2 border-primary bg-primary/5 px-2 py-1.5 text-[10px] uppercase tracking-[0.1em] text-primary font-bold flex items-center gap-1.5"><span>📍</span><span className="truncate">{sel.location_label}</span></div>
                        )}
                        <div className="text-[9px] uppercase tracking-[0.12em] flex items-center gap-1.5">
                          {anchorStatus === "exact" ? (
                            <span className="px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/30">Anchor: exact</span>
                          ) : anchorStatus === "approximate" ? (
                            <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-600 border border-amber-500/30" title={anchorReason}>Anchor: approximate</span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-muted text-muted-foreground border border-border" title={anchorReason}>Anchor: unavailable</span>
                          )}
                          {anchorStatus !== "exact" && anchorReason && (
                            <span className="text-muted-foreground normal-case tracking-normal text-[10px] italic truncate">{anchorReason}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground leading-relaxed">{sel.description || "No description provided."}</div>
                        {sel.location?.source_excerpt && (
                          <div className="text-[10px] italic text-muted-foreground border-l-2 border-border pl-2 mt-1">"{sel.location.source_excerpt}"</div>
                        )}
                        {sel.linked_item?.missing_refs && sel.linked_item.missing_refs.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {sel.linked_item.missing_refs.map((m, i) => (
                              <span key={i} className="text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 bg-[hsl(var(--status-blocked))]/15 text-[hsl(var(--status-blocked))] border border-[hsl(var(--status-blocked))]/30">missing: {m}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                )}

                {tab === "impact" && (
                  <section>
                    <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.12em] mb-2 flex items-center gap-1.5">
                      <Sync className="w-3.5 h-3.5" /> Affected Estimate Rows
                    </h3>
                    {sel.linked_item ? (
                      <div className="bg-card p-3 border border-border relative overflow-hidden">
                        <div className="absolute top-0 right-0 px-2 py-0.5 bg-[hsl(var(--status-inferred))] text-black text-[9px] font-black uppercase">Stale</div>
                        <div className="flex justify-between items-center mb-1 pr-12">
                          <span className="text-[12px] font-bold truncate">{sel.linked_item.description || "Row"}</span>
                          <span className="text-primary font-mono text-[10px]">{(sel.linked_item.total_weight || 0).toFixed(2)}t</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          {sel.linked_item.bar_size || "—"} · qty {sel.linked_item.quantity_count} · len {sel.linked_item.total_length}
                        </p>
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted-foreground italic">No estimate row linked.</div>
                    )}
                  </section>
                )}

                {tab === "evidence" && (
                  <section>
                    <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.12em] mb-2">Audit Record</h3>
                    <div className="border-l border-border ml-2 pl-4 space-y-3">
                      <div className="relative">
                        <div className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-primary" />
                        <p className="text-[11px] font-bold">Detected via {sel.issue_type || "audit"}</p>
                        <p className="text-[10px] text-muted-foreground">{sel.description || `Issue surfaced on ${sel.sheet_id || "linked sheet"}.`}</p>
                        <p className="text-[9px] text-muted-foreground/60 font-mono mt-1">{sel.id.slice(0, 18)}</p>
                      </div>
                    </div>
                    {sel.source_refs && (
                      <pre className="mt-3 whitespace-pre-wrap break-all text-[10px] font-mono text-muted-foreground max-h-48 overflow-auto bg-background/40 p-2 border border-border">
{JSON.stringify(sel.source_refs, null, 2)}
                      </pre>
                    )}
                  </section>
                )}

                {tab === "action" && (
                  <section className="space-y-3">
                    <div className="bg-background/60 p-3 border border-primary/40 space-y-3">
                      <div>
                        <div className="text-[10px] font-bold text-primary uppercase tracking-[0.12em] mb-1.5">
                          {engineerDraft.draftAnswer ? "Found Answer / Confirmation Needed" : "Engineer Question"}
                        </div>
                        <div className="text-[13px] text-foreground leading-relaxed font-medium">{engineerQuestion}</div>
                      </div>
                      {engineerDraft.draftAnswer && (
                        <div className="text-[10px] text-muted-foreground bg-card/50 border border-border p-2">
                          {engineerDraft.confidence === "high"
                            ? "High evidence quality: confirm or edit this answer."
                            : "Found drawing callout: confirm missing dimensions."}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div className="border border-border bg-card/60 p-2">
                          <div className="uppercase tracking-[0.12em] text-muted-foreground mb-1">Location</div>
                          <div className="font-bold text-foreground truncate">{sel.location_label || `P${sel.locator?.page_number || pdfPage}`}</div>
                        </div>
                        <div className="border border-border bg-card/60 p-2">
                          <div className="uppercase tracking-[0.12em] text-muted-foreground mb-1">Object</div>
                          <div className="font-bold text-foreground truncate">{objectIdentity || "Drawing target"}</div>
                        </div>
                      </div>
                      {sel.location?.source_excerpt && (
                        <div className="text-[10px] italic text-muted-foreground border-l-2 border-primary/40 pl-2">"{sel.location.source_excerpt}"</div>
                      )}
                      {missingRefs.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {missingRefs.map((m, i) => (
                            <span key={i} className="text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 bg-[hsl(var(--status-blocked))]/15 text-[hsl(var(--status-blocked))] border border-[hsl(var(--status-blocked))]/30">missing: {m}</span>
                          ))}
                        </div>
                      )}
                      <label className="block">
                        <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1">Engineer Response</span>
                        <textarea
                          ref={answerBoxRef}
                          value={answerText}
                          onChange={(e) => { setAnswerEdited(true); setAnswerText(e.target.value); }}
                          placeholder="Type the engineer answer here, e.g. wall length 10m, wall height 1200mm, rebar 15M @ 406mm O.C."
                          rows={5}
                          className="w-full bg-card border border-border px-2 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
                        />
                      </label>
                      <details className="border border-border bg-card/40 p-2">
                        <summary className="cursor-pointer text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Optional structured values</summary>
                        <div className="space-y-2 mt-2">
                          {answerFields.map((field) => (
                            <label key={field.key} className="block">
                              <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1">{field.label}</span>
                              {field.key === "notes" || field.key === "answer" ? (
                                <textarea
                                  value={answerValues[field.key] || ""}
                                  onChange={(e) => setAnswerValues((v) => ({ ...v, [field.key]: e.target.value }))}
                                  placeholder={field.placeholder}
                                  rows={field.key === "notes" ? 2 : 3}
                                  className="w-full bg-card border border-border px-2 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
                                />
                              ) : (
                                <input
                                  value={answerValues[field.key] || ""}
                                  onChange={(e) => setAnswerValues((v) => ({ ...v, [field.key]: e.target.value }))}
                                  placeholder={field.placeholder}
                                  className="w-full bg-card border border-border px-2 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
                                />
                              )}
                            </label>
                          ))}
                        </div>
                      </details>
                      {sel.resolution_note && (
                        <div className="text-[10px] text-muted-foreground bg-card/50 border border-border p-2">Saved: {sel.resolution_note}</div>
                      )}
                      {answerError && (
                        <div className="text-[10px] text-[hsl(var(--status-blocked))] border border-[hsl(var(--status-blocked))]/30 bg-[hsl(var(--status-blocked))]/10 p-2">{answerError}</div>
                      )}
                      <div className="grid grid-cols-3 gap-2">
                        <button disabled={answerSaving} onClick={() => saveEngineerAnswer("answered")} className="py-2 bg-primary text-primary-foreground font-bold text-[10px] uppercase tracking-[0.12em] hover:opacity-90 disabled:opacity-50">{answerSaving ? "Saving…" : answerSavedAt && Date.now() - answerSavedAt < 1500 ? "Saved ✓" : "Save Answer"}</button>
                        <button disabled={answerSaving} onClick={() => saveEngineerAnswer("resolved")} className="py-2 bg-secondary text-secondary-foreground font-bold text-[10px] uppercase tracking-[0.12em] hover:opacity-90 disabled:opacity-50">Mark Resolved</button>
                        <button disabled={answerSaving} onClick={() => persistIssueStatus("review", answerText.trim() || "Engineer marked this issue for review.", answerValues, answerText.trim())} className="py-2 bg-secondary text-secondary-foreground font-bold text-[10px] uppercase tracking-[0.12em] hover:opacity-90 disabled:opacity-50">Needs Review</button>
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          {/* Action rail (always visible) */}
          {sel && (
            <div className="p-3 bg-background/40 border-t border-border space-y-2">
              <button
                onClick={jumpToTakeoff}
                className="w-full py-2.5 bg-primary text-primary-foreground font-bold text-[11px] uppercase tracking-[0.14em] flex items-center justify-center gap-2 hover:opacity-90"
              >
                <RefreshCw className="w-4 h-4" /> Open Takeoff / Re-run
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => persistIssueStatus("answered", answerText.trim() || "Engineer accepted this issue unchanged.", answerValues, answerText.trim())} disabled={answerSaving} className="py-2 bg-card border border-border text-foreground font-bold text-[10px] uppercase tracking-[0.12em] hover:bg-accent/40 disabled:opacity-50">
                  Accept Unchanged
                </button>
                <button onClick={() => persistIssueStatus("review", answerText.trim() || "Engineer marked this issue for review.", answerValues, answerText.trim())} disabled={answerSaving} className="py-2 bg-card border border-border text-foreground font-bold text-[10px] uppercase tracking-[0.12em] hover:bg-accent/40 disabled:opacity-50">
                  Mark for Review
                </button>
              </div>
              <button onClick={() => persistIssueStatus("resolved", answerText.trim() || "Engineer marked this issue as no impact.", answerValues, answerText.trim())} disabled={answerSaving} className="w-full py-1.5 text-muted-foreground font-bold text-[10px] uppercase tracking-[0.12em] hover:text-foreground disabled:opacity-50">
                Mark No Impact
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function BBoxPointer({
  bbox, imgW, imgH, viewZoom, title, onFix, approximate,
}: {
  bbox: BBox;
  imgW: number;
  imgH: number;
  viewZoom?: number;
  title: string;
  onFix: () => void;
  approximate?: boolean;
}) {
  // Positioned via % relative to the image-fit wrapper (which auto-sizes to
  // the rendered <img> box), so the pointer always sits exactly on the bbox
  // regardless of canvas zoom/pan or measurement timing.
  const leftPct = (bbox[0] / imgW) * 100;
  const topPct = (bbox[1] / imgH) * 100;
  const widthPct = ((bbox[2] - bbox[0]) / imgW) * 100;
  const heightPct = ((bbox[3] - bbox[1]) / imgH) * 100;
  const vz = Math.max(1, viewZoom ?? 1);
  const stroke = approximate ? "#f59e0b" : "#ff7a1a";
  const borderPx = Math.max(1, 2 / vz);
  const haloPx = Math.max(0.5, 1.5 / vz);
  const labelScale = Math.min(1, Math.max(0.16, 1 / vz));
  const fillBg = approximate ? "rgba(245,158,11,0.035)" : "rgba(255,122,26,0.025)";
  return (
    <div
      className="absolute pointer-events-auto group cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onFix(); }}
      title={title}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${widthPct}%`,
        height: `${heightPct}%`,
        border: `${borderPx}px ${approximate ? "dashed" : "solid"} ${stroke}`,
        background: fillBg,
        boxShadow: `0 0 0 ${haloPx}px ${stroke}44`,
      }}
    >
      <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full grid place-items-center text-white shadow-md" style={{ background: stroke, transform: `scale(${labelScale})`, transformOrigin: "center" }}>
        <span className="text-[10px] font-bold">{approximate ? "≈" : "!"}</span>
      </div>
    </div>
  );
}
