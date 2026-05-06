import { Fragment, useEffect, useMemo, useState } from "react";
import { StageHeader, Pill, EmptyState, GateBanner, type StageProps } from "./_shared";
import {
  ArrowLeft, ArrowRight, Wand2, Filter, Layers, Columns2, GitCompare,
  ZoomIn, ZoomOut, Maximize2, Eye, Edit3, AlertTriangle, RefreshCw,
  Fingerprint, History, GitBranch, Scale, Edit2, RefreshCw as Sync, Bug,
} from "lucide-react";
import { loadWorkflowQaIssues, type WorkflowQaIssue } from "../takeoff-data";
import { supabase } from "@/integrations/supabase/client";
import PdfRenderer from "@/components/chat/PdfRenderer";

type TabKey = "change" | "impact" | "evidence" | "action";

function tightBox(
  items: Array<{ x: number; y: number; w: number; h: number }>,
  imgW: number,
  imgH: number,
): [number, number, number, number] | null {
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
  const [viewMode, setViewMode] = useState<"overlay" | "side" | "diff">("overlay");
  const [changedOnly, setChangedOnly] = useState(true);
  const [debug, setDebug] = useState(false);
  const [redrawCount, setRedrawCount] = useState(0);
  const [lastTrigger, setLastTrigger] = useState<string>("init");
  const [renderedPage, setRenderedPage] = useState<number | null>(null);
  // Text items extracted from the rendered PDF page (image-pixel space).
  const [pageText, setPageText] = useState<Array<{ str: string; x: number; y: number; w: number; h: number }>>([]);

  const bump = (reason: string) => {
    setRedrawCount((c) => c + 1);
    setLastTrigger(reason);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, sel?.locator?.page_number]);

  useEffect(() => { setZoomMode("tight"); setZoomLevel(1); setPan({ dx: 0, dy: 0 }); setTab("change"); }, [sel?.id]);

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null); setPreviewKind(null); setPdfImg(null);
    setPdfPageCount(1); setPreviewName("");
    // Initialize page from the issue locator (do NOT force back to 1, that
    // was the bug that caused the cover sheet to always appear).
    const initialPage = sel?.locator?.page_number;
    if (initialPage && initialPage > 0) setPdfPage(initialPage);
    else setPdfPage((p) => p || 1);
    const fileId = sel?.source_file_id || sel?.linked_item?.source_file_id || null;
    if (!fileId) return;
    setPreviewLoading(true);
    (async () => {
      const { data: file } = await supabase
        .from("project_files")
        .select("file_name,file_path,file_type")
        .eq("id", fileId)
        .maybeSingle();
      if (cancelled || !file?.file_path) { setPreviewLoading(false); return; }
      const { data: signed } = await supabase.storage.from("blueprints").createSignedUrl(file.file_path, 3600);
      if (cancelled) return;
      const url = signed?.signedUrl || null;
      const isPdf = (file.file_path || "").toLowerCase().endsWith(".pdf") || (file.file_type || "").toLowerCase().includes("pdf");
      setPreviewUrl(url);
      setPreviewKind(url ? (isPdf ? "pdf" : "image") : null);
      setPreviewName(file.file_name || "");
      setPreviewLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sel?.source_file_id, sel?.id]);

  useEffect(() => { bump(`view mode → ${viewMode}`); /* eslint-disable-next-line */ }, [viewMode]);
  useEffect(() => { bump(`zoom mode → ${zoomMode}`); /* eslint-disable-next-line */ }, [zoomMode]);
  useEffect(() => { bump(`zoom level → ${zoomLevel.toFixed(2)}x`); /* eslint-disable-next-line */ }, [zoomLevel]);
  useEffect(() => { if (pdfImg) bump(`pdf rendered p${pdfPage}`); /* eslint-disable-next-line */ }, [pdfImg]);

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

  // Bbox-driven crop
  const locator = sel?.locator || null;
  const exactBbox = locator?.bbox || null;
  const imgW = locator?.image_size?.w || imgSize?.w || 0;
  const imgH = locator?.image_size?.h || imgSize?.h || 0;
  // Fallback: derive an approximate bbox by matching the issue's anchor text
  // (callout / element ref / source excerpt) against extracted PDF text items.
  const approxBbox = useMemo<[number, number, number, number] | null>(() => {
    if (exactBbox) return null;
    if (!pageText || pageText.length === 0) return null;
    const loc = sel?.location || {};
    const anchors: string[] = [];
    const push = (v?: string | null) => {
      if (!v) return;
      const s = String(v).trim();
      if (s.length >= 3) anchors.push(s);
    };
    push(loc.element_reference); push(loc.detail_reference); push(loc.grid_reference);
    push(loc.source_excerpt);
    push(sel?.linked_item?.bar_size);
    if (loc.source_excerpt) {
      const m = String(loc.source_excerpt).match(/"([^"]{3,60})"|([A-Z0-9][A-Z0-9 \-#@.\/]{3,60})/);
      if (m) push(m[1] || m[2]);
    }
    if (anchors.length === 0) return null;

    // Group text items into lines by y-band (median item height).
    const heights = pageText.map((t) => t.h).filter((h) => h > 0).sort((a, b) => a - b);
    const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 8;
    const yTol = Math.max(4, medH * 0.6);
    const sorted = [...pageText].sort((a, b) => a.y - b.y || a.x - b.x);
    type Line = { items: typeof pageText; y: number; text: string };
    const lines: Line[] = [];
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
      ln.text = ln.items.map((i) => i.str).join(" ").toLowerCase().replace(/\s+/g, " ");
    }

    // Find the best matching line: prefer the longest anchor that hits.
    anchors.sort((a, b) => b.length - a.length);
    let bestLine: Line | null = null;
    let bestAnchor = "";
    for (const a of anchors) {
      const needle = a.toLowerCase().replace(/\s+/g, " ");
      const hit = lines.find((ln) => ln.text.includes(needle));
      if (hit) { bestLine = hit; bestAnchor = needle; break; }
    }
    // Fallback: token-level match on the longest anchor.
    if (!bestLine) {
      for (const a of anchors) {
        const needle = a.toLowerCase().replace(/\s+/g, " ");
        const tok = pageText.find((t) => t.str.toLowerCase().includes(needle));
        if (tok) {
          return tightBox([tok], imgW, imgH);
        }
      }
      return null;
    }

    // Restrict to the matched-token span within the line for tightest possible box.
    const line = bestLine;
    let span = line.items;
    if (bestAnchor) {
      // Walk items and find contiguous run whose joined text covers the anchor.
      const lower = line.items.map((i) => i.str.toLowerCase());
      for (let i = 0; i < lower.length; i++) {
        let acc = "";
        for (let j = i; j < lower.length; j++) {
          acc = (acc + " " + lower[j]).trim();
          if (acc.replace(/\s+/g, " ").includes(bestAnchor)) {
            span = line.items.slice(i, j + 1);
            i = lower.length; // break outer
            break;
          }
        }
      }
    }
    return tightBox(span, imgW, imgH);
  }, [exactBbox, pageText, sel?.id, sel?.location, sel?.linked_item?.bar_size, imgW, imgH]);
  const bbox = exactBbox || approxBbox;
  const bboxIsApprox = !exactBbox && !!approxBbox;
  const center = bbox && imgW && imgH
    ? { cx: ((bbox[0] + bbox[2]) / 2) / imgW, cy: ((bbox[1] + bbox[3]) / 2) / imgH }
    : { cx: 0.5, cy: 0.5 };
  const bboxW = bbox ? Math.max(1, bbox[2] - bbox[0]) : 0;
  const bboxH = bbox ? Math.max(1, bbox[3] - bbox[1]) : 0;
  const PAD = 1.3;
  const fitZoom = bbox && imgW && imgH ? Math.min(imgW / (bboxW * PAD), imgH / (bboxH * PAD)) : 1;
  const autoZoom = zoomMode === "tight" && bbox ? Math.min(12, Math.max(2, fitZoom)) : 1;
  const zoom = Math.min(24, Math.max(0.5, autoZoom * zoomLevel));
  const txBase = (0.5 - center.cx) * 100 * zoom;
  const tyBase = (0.5 - center.cy) * 100 * zoom;
  const tx = txBase + pan.dx;
  const ty = tyBase + pan.dy;

  const TABS: Array<{ k: TabKey; label: string }> = [
    { k: "change", label: "Change" },
    { k: "impact", label: "Impact" },
    { k: "evidence", label: "Evidence" },
    { k: "action", label: "Action" },
  ];

  const jumpToTakeoff = () => {
    const linked = sel?.linked_item;
    state.setLocal({
      takeoffFocus: linked
        ? {
            raw_id: linked.id,
            raw_kind: "legacy",
            source_file_id: linked.source_file_id || sel?.source_file_id || null,
            segment_id: linked.segment_id || null,
            page_number: linked.page_number ?? sel?.locator?.page_number ?? null,
            issue_id: sel?.id || null,
          }
        : {
            source_file_id: sel?.source_file_id || null,
            page_number: sel?.locator?.page_number ?? null,
            issue_id: sel?.id || null,
          },
    });
    goToStage?.("takeoff");
  };

  const sheetTone = (items: WorkflowQaIssue[]): "blocked" | "inferred" | "direct" | "default" => {
    if (items.some((i) => ["critical", "error"].includes(i.severity?.toLowerCase()))) return "blocked";
    if (items.some((i) => i.severity?.toLowerCase() === "warning")) return "inferred";
    if (items.length > 0) return "direct";
    return "default";
  };

  return (
    <div className="flex flex-col h-full">
      {critCount > 0 && (
        <div className="px-4 pt-3">
          <GateBanner
            tone="blocked"
            title="Approval Gate Blocked"
            message={`${critCount} Critical Blocker${critCount === 1 ? "" : "s"} remaining. Export functionality is currently disabled.`}
          />
        </div>
      )}
      <div className="grid grid-cols-12 flex-1 min-h-0">
        {/* LEFT — Revision Navigator */}
        <aside className="col-span-3 border-r border-border bg-card flex flex-col min-h-0">
          <div className="p-3 border-b border-border space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Revision Navigator</h2>
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <label className="flex items-center justify-between bg-background/60 px-2 py-1.5 cursor-pointer">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Changed Sheets Only</span>
              <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} className="accent-primary h-3 w-3" />
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-background/60 p-2 border border-border">
                <p className="text-[9px] text-muted-foreground uppercase font-bold">Base Rev</p>
                <p className="text-[12px] font-bold">Rev 2 (IFC)</p>
              </div>
              <div className="bg-background/60 p-2 border border-primary/40">
                <p className="text-[9px] text-primary uppercase font-bold">Target Rev</p>
                <p className="text-[12px] font-bold">Rev 3 (Delta)</p>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {loading ? (
              <EmptyState title="Loading…" />
            ) : visibleSheets.length === 0 ? (
              <EmptyState title="No QA issues" hint="Advance to confirmation when takeoff looks correct." />
            ) : (
              visibleSheets.map((sh) => {
                const tone = sheetTone(sh.items);
                const isActive = sh.items.some((i) => i.id === selectedId);
                return (
                  <Fragment key={sh.key}>
                    {sh.items.map((it, idx) => {
                      const sev = it.severity?.toLowerCase();
                      const tag = ["critical", "error"].includes(sev) ? "Changed" : sev === "warning" ? "Impacted" : "Blocked";
                      const tagTone = ["critical", "error"].includes(sev) ? "blocked" : sev === "warning" ? "inferred" : "direct";
                      const isSel = it.id === selectedId;
                      return (
                        <button
                          key={it.id}
                          onClick={() => setSelectedId(it.id)}
                          className={`w-full text-left px-3 py-2.5 border-b border-border/60 transition-colors ${isSel ? "bg-primary/10 border-r-2 border-r-primary" : "hover:bg-accent/40 border-r-2 border-r-transparent"}`}
                        >
                          <div className="flex justify-between items-start mb-1 gap-2">
                            <span className="text-[12px] font-mono font-bold truncate">{idx === 0 ? sh.name.toUpperCase() : `· ${(it.title || it.id).slice(0, 22)}`}</span>
                            <Pill tone={tagTone as any} solid>{tag}</Pill>
                          </div>
                          <div className="flex gap-3 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                            <span className="flex items-center gap-1"><Edit2 className="w-2.5 h-2.5" /> {it.issue_type || "issue"}</span>
                            {it.linked_item && <span className="flex items-center gap-1"><Scale className="w-2.5 h-2.5" /> {(it.linked_item.total_weight || 0).toFixed(2)}t</span>}
                          </div>
                          {sev === "warning" && (
                            <p className="text-[10px] text-[hsl(var(--status-blocked))] mt-1 italic font-medium truncate">{(it.location_label ? `${it.location_label} — ` : "") + (it.description || "").replace(it.location_label ? `${it.location_label}: ` : "", "")}</p>
                          )}
                        </button>
                      );
                    })}
                  </Fragment>
                );
              })
            )}
          </div>
        </aside>

        {/* CENTER — Drawing Canvas */}
        <main className="col-span-6 flex flex-col relative min-h-0 bg-background">
          {/* Summary bar */}
          <div className="h-10 bg-card border-b border-border flex items-center px-4 gap-5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5 text-primary" /><span className="text-primary font-bold">{totalImpact}</span> changes detected</span>
            <span className="w-px h-3 bg-border" />
            <span><span className="text-foreground font-bold">{warnCount}</span> quantity impacts</span>
            <span><span className="text-[hsl(var(--status-inferred))] font-bold">{warnCount}</span> rows require re-run</span>
            <span><span className="text-[hsl(var(--status-blocked))] font-bold">{staleOutputs}</span> outputs stale</span>
            <div className="flex-1" />
            <button
              disabled={loading || critCount > 0}
              onClick={() => goToStage?.("confirm")}
              className="inline-flex h-7 items-center gap-1.5 border border-primary/50 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Advance <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {/* Floating toolbar */}
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 flex gap-1 p-1 bg-card border border-border shadow-2xl">
            {[
              { k: "overlay", label: "Overlay", icon: Layers },
              { k: "side", label: "Side-by-Side", icon: Columns2 },
              { k: "diff", label: "Difference", icon: GitCompare },
            ].map((m) => {
              const Active = m.icon;
              const on = viewMode === m.k;
              return (
                <button
                  key={m.k}
                  onClick={() => setViewMode(m.k as any)}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/40"}`}
                >
                  <Active className="w-3.5 h-3.5" /> {m.label}
                </button>
              );
            })}
            <div className="w-px h-6 bg-border mx-1 my-0.5" />
            <button onClick={() => setZoomLevel((z) => Math.min(4, Number((z * 1.25).toFixed(2))))} className="p-1.5 text-muted-foreground hover:text-foreground" title="Zoom in"><ZoomIn className="w-4 h-4" /></button>
            <button onClick={() => setZoomLevel((z) => Math.max(0.5, Number((z / 1.25).toFixed(2))))} className="p-1.5 text-muted-foreground hover:text-foreground" title="Zoom out"><ZoomOut className="w-4 h-4" /></button>
            <button onClick={() => { setZoomMode((m) => m === "tight" ? "full" : "tight"); setZoomLevel(1); }} className="p-1.5 text-muted-foreground hover:text-foreground" title="Toggle fit mode"><Maximize2 className="w-4 h-4" /></button>
            <div className="w-px h-6 bg-border mx-1 my-0.5" />
            <button className="p-1.5 text-muted-foreground hover:text-foreground"><Eye className="w-4 h-4" /></button>
            <button
              onClick={() => setDebug((d) => !d)}
              className={`p-1.5 ${debug ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              title="Toggle debug overlay"
            >
              <Bug className="w-4 h-4" />
            </button>
          </div>

          {/* Canvas */}
          <div
            className="flex-1 overflow-hidden relative blueprint-bg cursor-grab active:cursor-grabbing select-none"
            onWheel={(e) => {
              if (!sel) return;
              e.preventDefault();
              const delta = -e.deltaY;
              const factor = delta > 0 ? 1.1 : 1 / 1.1;
              setZoomLevel((z) => Math.min(8, Math.max(0.25, Number((z * factor).toFixed(3)))));
              bump(`wheel zoom ${delta > 0 ? "in" : "out"}`);
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              const startX = e.clientX, startY = e.clientY;
              const startPan = { ...pan };
              const rect = el.getBoundingClientRect();
              const move = (ev: PointerEvent) => {
                const ddx = ((ev.clientX - startX) / rect.width) * 100;
                const ddy = ((ev.clientY - startY) / rect.height) * 100;
                setPan({ dx: startPan.dx + ddx, dy: startPan.dy + ddy });
              };
              const up = (ev: PointerEvent) => {
                el.releasePointerCapture(ev.pointerId);
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", up);
                el.removeEventListener("pointercancel", up);
                bump("drag end");
              };
              el.addEventListener("pointermove", move);
              el.addEventListener("pointerup", up);
              el.addEventListener("pointercancel", up);
            }}
            onDoubleClick={() => { setPan({ dx: 0, dy: 0 }); setZoomLevel(1); bump("dbl click reset"); }}
          >
            {!sel ? (
              <div className="absolute inset-0 grid place-items-center text-[10px] uppercase tracking-widest text-muted-foreground">Select an issue from the navigator</div>
            ) : (
              <>
                {previewKind === "pdf" && previewUrl && (
                  <PdfRenderer
                    url={previewUrl}
                    currentPage={pdfPage}
                    onPageCount={setPdfPageCount}
                    onPageRendered={(dataUrl, w, h) => {
                      setPdfImg(dataUrl);
                      setImgSize({ w, h });
                      setRenderedPage(pdfPage);
                    }}
                    onPageText={setPageText}
                    scale={2}
                  />
                )}
                {(previewKind === "image" || (previewKind === "pdf" && pdfImg)) && (
                  <div
                    className={`absolute inset-0 ${viewMode === "side" ? "grid grid-cols-2 gap-px bg-border" : ""}`}
                    style={viewMode === "side" ? undefined : {
                      transform: `translate(${tx}%, ${ty}%) scale(${zoom})`,
                      transformOrigin: "center center",
                      transition: "transform 0.05s linear",
                    }}
                  >
                    {viewMode === "side" ? (
                      <>
                        <div className="relative w-full h-full bg-background overflow-hidden">
                          <div className="absolute top-1 left-1 z-10 px-1.5 py-0.5 bg-card/90 border border-border text-[9px] uppercase tracking-[0.12em] font-bold">Rev 2 (Base)</div>
                          <img src={previewKind === "pdf" ? (pdfImg || "") : (previewUrl || "")} alt={previewName} className="w-full h-full object-contain" style={{ transform: `translate(${tx}%, ${ty}%) scale(${zoom})`, transformOrigin: "center center", transition: "transform 0.05s linear" }} draggable={false} />
                        </div>
                        <div className="relative w-full h-full bg-background overflow-hidden">
                          <div className="absolute top-1 left-1 z-10 px-1.5 py-0.5 bg-primary/20 border border-primary/50 text-[9px] uppercase tracking-[0.12em] font-bold text-primary">Rev 3 (Target)</div>
                          <img src={previewKind === "pdf" ? (pdfImg || "") : (previewUrl || "")} alt={`${previewName} target`} className="w-full h-full object-contain" style={{ filter: "sepia(1) hue-rotate(150deg) saturate(2.2) contrast(1.1)", transform: `translate(${tx}%, ${ty}%) scale(${zoom})`, transformOrigin: "center center", transition: "transform 0.05s linear" }} draggable={false} />
                        </div>
                      </>
                    ) : (
                      <img
                        src={previewKind === "pdf" ? (pdfImg || "") : (previewUrl || "")}
                        alt={previewName}
                        onLoad={(e) => {
                          if (previewKind === "image") {
                            const t = e.currentTarget;
                            setImgSize({ w: t.naturalWidth, h: t.naturalHeight });
                          }
                        }}
                        className="absolute inset-0 w-full h-full object-contain"
                        style={viewMode === "diff" ? { mixBlendMode: "difference", filter: "invert(1) hue-rotate(180deg)" } : undefined}
                        draggable={false}
                      />
                    )}
                    {viewMode !== "side" && bbox && imgW && imgH && (
                      <>
                        {/* Wrapper that mirrors the object-contain placement of the image so
                            the pointer aligns with the actual rendered drawing region. */}
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            // Compute letterbox: image is contained in the container
                            // preserving aspect ratio. We don't know container px size
                            // here, but using percentage of imgW/imgH against the same
                            // object-contain box keeps overlay aligned because bbox is
                            // also expressed in image pixel space.
                          }}
                        >
                          <BBoxPointer
                            bbox={bbox}
                            imgW={imgW}
                            imgH={imgH}
                            zoom={zoom}
                            approximate={bboxIsApprox}
                            title={sel?.title || "Modification"}
                            description={[sel?.location_label, sel?.description || "Is this element correct as detected?"].filter(Boolean).join(" — ")}
                            onFix={jumpToTakeoff}
                            onImpact={() => setTab("impact")}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
                {/* DEBUG OVERLAY */}
                {debug && (
                  <div className="absolute top-14 right-4 z-30 w-[300px] bg-card/95 border border-primary/60 shadow-2xl text-[10px] font-mono p-2 space-y-0.5 pointer-events-auto">
                    <div className="font-bold text-primary uppercase tracking-[0.12em] flex justify-between">
                      <span>QA Debug</span>
                      <span>#{redrawCount}</span>
                    </div>
                    <div>last: <span className="text-foreground">{lastTrigger}</span></div>
                    <div>view: <span className="text-primary">{viewMode}</span> · zoom: {zoomMode} × {zoomLevel.toFixed(2)} ({Math.round(zoom * 100)}%)</div>
                    <div>blend: {viewMode === "diff" ? "difference / invert(1)" : viewMode === "side" ? "sepia+hue (rev3)" : "none"}</div>
                    <div>tx/ty: {tx.toFixed(1)}% / {ty.toFixed(1)}%</div>
                    <div>page req: {pdfPage} · rendered: {renderedPage ?? "—"} / {pdfPageCount}</div>
                    <div>imgSize: {imgW || "?"}×{imgH || "?"}</div>
                    <div>bbox: {bbox ? `[${bbox.map((v) => Math.round(v)).join(",")}]` : "none"}</div>
                    <div>file: <span className="truncate inline-block max-w-[220px] align-bottom">{previewName || "—"}</span></div>
                    <div>kind: {previewKind || "—"} · loading: {String(previewLoading)}</div>
                    <div>issue: {sel?.id?.slice(0, 24) || "—"}</div>
                    <div className="text-[hsl(var(--status-blocked))]">compare src: single (no Rev2/Rev3 assets linked)</div>
                  </div>
                )}
                {/* DEBUG canvas + image bounds */}
                {debug && (
                  <>
                    <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-[hsl(var(--status-inferred))]/70 z-20" />
                    {bbox && imgW && imgH && (
                      <div className="absolute inset-0 pointer-events-none z-20" style={{ transform: viewMode === "side" ? undefined : `translate(${tx}%, ${ty}%) scale(${zoom})`, transformOrigin: "center center" }}>
                        <div className="absolute" style={{
                          left: `${(bbox[0] / imgW) * 100}%`, top: `${(bbox[1] / imgH) * 100}%`,
                          width: `${((bbox[2] - bbox[0]) / imgW) * 100}%`, height: `${((bbox[3] - bbox[1]) / imgH) * 100}%`,
                          border: "1px dashed cyan",
                        }} />
                      </div>
                    )}
                  </>
                )}
                {!previewUrl && !previewLoading && (
                  <div className="absolute inset-0 grid place-items-center text-[10px] uppercase tracking-widest text-muted-foreground">No linked drawing for this issue</div>
                )}
                {previewLoading && (
                  <div className="absolute inset-0 grid place-items-center text-[10px] uppercase tracking-widest text-muted-foreground">Loading drawing…</div>
                )}
                {!bbox && previewUrl && (
                  <div className="absolute top-14 right-4 z-10 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--status-inferred))] border border-[hsl(var(--status-inferred))]/30 bg-[hsl(var(--status-inferred))]/10 px-2 py-1">
                    Page-linked · exact element region not yet pinned
                  </div>
                )}
                {bboxIsApprox && previewUrl && (
                  <div className="absolute top-14 right-4 z-10 text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--status-inferred))] border border-[hsl(var(--status-inferred))]/40 bg-[hsl(var(--status-inferred))]/10 px-2 py-1">
                    Approximate anchor · matched from text
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
              <span>Zoom: {Math.round(zoom * 100)}%</span>
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
                  <section className="space-y-2">
                    <div className="bg-background/60 p-3 border border-border">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.12em] mb-1.5 flex items-center gap-1.5"><Wand2 className="w-3 h-3" /> Recommended Fix</div>
                      <div className="text-[11px] italic text-muted-foreground">Review element source and apply standard correction per project spec, then re-run takeoff for this row.</div>
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
                <RefreshCw className="w-4 h-4" /> Re-run Affected Items
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className="py-2 bg-card border border-border text-foreground font-bold text-[10px] uppercase tracking-[0.12em] hover:bg-accent/40">
                  Accept Unchanged
                </button>
                <button className="py-2 bg-card border border-border text-foreground font-bold text-[10px] uppercase tracking-[0.12em] hover:bg-accent/40">
                  Mark for Review
                </button>
              </div>
              <button className="w-full py-1.5 text-muted-foreground font-bold text-[10px] uppercase tracking-[0.12em] hover:text-foreground">
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
  bbox, imgW, imgH, zoom, title, description, onFix, onImpact, approximate,
}: {
  bbox: [number, number, number, number];
  imgW: number;
  imgH: number;
  zoom: number;
  title: string;
  description: string;
  onFix: () => void;
  onImpact: () => void;
  approximate?: boolean;
}) {
  // Bbox is in image-pixel space; the image is rendered with object-contain
  // so percentages of imgW/imgH applied within the same containing box align
  // with the visible drawing region.
  const left = (bbox[0] / imgW) * 100;
  const top = (bbox[1] / imgH) * 100;
  const width = ((bbox[2] - bbox[0]) / imgW) * 100;
  const height = ((bbox[3] - bbox[1]) / imgH) * 100;
  const z = Math.max(1, zoom);
  const stroke = approximate ? "#f59e0b" : "#ff7a1a";
  const fillBg = approximate ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.18)";
  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
        border: `${Math.max(2, 6 / z)}px ${approximate ? "dashed" : "solid"} ${stroke}`,
        background: fillBg,
        boxShadow: `0 0 0 ${Math.max(1, 4 / z)}px ${stroke}55`,
      }}
    >
      <div className="absolute -top-3 -right-3 w-6 h-6 rounded-full grid place-items-center text-white shadow-lg" style={{ background: stroke, transform: `scale(${1 / z})`, transformOrigin: "center" }}>
        <span className="text-[10px] font-bold">{approximate ? "≈" : "!"}</span>
      </div>
      <div
        className="absolute left-1/2 bg-card border border-border shadow-2xl px-3 py-2 w-56 z-30"
        style={{ top: "calc(100% + 8px)", transform: `translateX(-50%) scale(${1 / z})`, transformOrigin: "top center" }}
      >
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground mb-1.5 truncate">{title}</div>
        <div className="text-[10px] text-muted-foreground leading-snug mb-2 line-clamp-3">{description}</div>
        <div className="grid grid-cols-2 gap-1">
          <button onClick={(e) => { e.stopPropagation(); onFix(); }} className="py-1 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-[0.1em] hover:opacity-90">Fix</button>
          <button onClick={(e) => { e.stopPropagation(); onImpact(); }} className="py-1 bg-card border border-border text-foreground text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-accent/40">Impact</button>
        </div>
      </div>
    </div>
  );
}
