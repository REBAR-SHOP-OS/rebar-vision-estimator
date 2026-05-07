import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { StageHeader, Pill, EmptyState, type StageProps } from "./_shared";
import { Sparkles, FileText, CheckCircle2, Loader2, Wand2, Pencil, Save, X, ChevronDown, ChevronRight } from "lucide-react";
import PdfRenderer from "@/components/chat/PdfRenderer";
import { loadWorkflowTakeoffRows, type WorkflowTakeoffRow } from "../takeoff-data";
import { parseAndIndexFile } from "@/lib/parse-file";
import { buildEngineerAnswerDraft } from "./qa-answer-fields";
import {
  CANADIAN_BAR_MASS_KG_PER_M,
  estimateCanadianLine,
  parsePieceLengthMm,
  parseSpacingMm,
} from "@/lib/canadian-rebar-estimating";

interface EditPatch {
  count?: number;
  length?: number;
  weight?: number;
  size?: string;
}

interface TakeoffFoundDisplay {
  qty: string;
  length: string;
  weight: string;
  found: string;
  question: string;
  confidence: "high" | "medium" | "low";
}

function compactMm(value: string) {
  return value.replace(/\s+/g, "");
}

function formatM(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(value < 1 ? 3 : 2)}m` : "--";
}

function extractFoundDisplay(row: WorkflowTakeoffRow): TakeoffFoundDisplay {
  const text = `${row.size} ${row.shape} ${row.missing_refs.join(" ")}`.replace(/\s+/g, " ").trim();
  const bar = text.match(/\b(10M|15M|20M|25M|30M|35M)\b/i)?.[1]?.toUpperCase() || (row.size !== "-" ? row.size : "");
  const pieceMatch = text.match(/\b(?:10M|15M|20M|25M|30M|35M)?\s*(?:x|\u00d7)?\s*(\d+(?:\.\d+)?)\s*(mm|m)\s*(?:\([^)]*\)\s*)?(?:long|dowels?|bars?)\b/i);
  const spacingMatch = text.match(/(?:@|at)\s*(\d+(?:\.\d+)?)\s*(mm|m)\s*(?:\([^)]*\)\s*)?O\.?\s*C\.?/i);
  const thicknessMatch = text.match(/\b(\d+(?:\.\d+)?)\s*mm\s+(?:frost\s+slab|foundation\s+wall|slab|wall|pad|footing)\b/i);
  const eachWay = /\beach\s+way\b|\be\.?\s*w\.?\b/i.test(text);
  const staggered = /\bstaggered\b/i.test(text);
  const pieceMm = parsePieceLengthMm(text) || (pieceMatch ? (pieceMatch[2].toLowerCase() === "m" ? Number(pieceMatch[1]) * 1000 : Number(pieceMatch[1])) : null);
  const pieceM = pieceMm ? pieceMm / 1000 : null;
  const spacingMm = parseSpacingMm(text);
  const canadianEstimate = estimateCanadianLine({
    barSize: bar,
    runLengthMm: row.length > 0 ? row.length * 1000 : null,
    spacingMm,
    pieceLengthMm: pieceMm,
    quantity: row.count > 0 ? row.count : null,
  });
  const spacing = spacingMatch ? `${compactMm(spacingMatch[1] + spacingMatch[2])} O.C.` : "";
  const thickness = thicknessMatch ? `${compactMm(thicknessMatch[1] + "mm")}` : "";
  const foundParts = [
    bar ? `bar ${bar}` : null,
    pieceM ? `piece length ${formatM(pieceM)}` : null,
    thickness ? `thickness ${thickness}` : null,
    spacing ? `spacing ${spacing}` : null,
    eachWay ? "each way" : null,
    staggered ? "staggered" : null,
  ].filter(Boolean) as string[];

  const draft = buildEngineerAnswerDraft({
    locationLabel: row.page_number ? `P${row.page_number}` : null,
    objectIdentity: row.shape,
    title: row.shape,
    sourceExcerpt: row.shape,
    missingRefs: row.missing_refs,
  });

  const needsRun = /run|length|dimension|element_dimensions|perimeter|edge/i.test(row.missing_refs.join(" "));
  const needsQty = /qty|quantity|count/i.test(row.missing_refs.join(" "));
  const found = foundParts.length
    ? `Found: ${foundParts.join("; ")}.`
    : draft.draftAnswer || `Found source text: "${row.shape}".`;
  const needsRunText = spacingMm ? "Need run" : "Ask";
  const inferredWeight = row.weight > 0
    ? row.weight.toFixed(1)
    : canadianEstimate.weightKg
      ? canadianEstimate.weightKg.toFixed(1)
      : bar && CANADIAN_BAR_MASS_KG_PER_M[bar]
        ? needsRunText
        : "Ask";

  return {
    qty: row.count > 0 ? String(row.count) : needsQty || needsRun ? "Need run" : "Ask",
    length: row.length > 0 ? row.length.toFixed(2) : pieceM ? `${formatM(pieceM)} ea` : thickness ? thickness : "Ask",
    weight: inferredWeight,
    found,
    question: `${draft.question} Canadian rule: count bars across the opposite direction; quantity = floor(run / spacing) + 1, then weight = total length x kg/m.`,
    confidence: foundParts.length ? "medium" : draft.confidence,
  };
}

export default function TakeoffStage({ projectId, state, goToStage }: StageProps) {
  const { user } = useAuth();
  const [rows, setRows] = useState<WorkflowTakeoffRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPatch, setEditPatch] = useState<EditPatch>({});
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfImg, setPdfImg] = useState<string | null>(null);
  const [segRunning, setSegRunning] = useState<string | null>(null);

  const reload = async () => {
    const mapped = await loadWorkflowTakeoffRows(projectId, state.files);
    setRows(mapped);
    setSelectedId((current) => mapped.find((row) => row.id === current)?.id || mapped[0]?.id || null);
  };

  const runSingleSegment = async (segName: string) => {
    // find segment_id from any row in the group (legacy rows carry segment_id)
    const seg = rows.find((r) => r.segment_name === segName && r.segment_id)?.segment_id;
    if (!seg) { toast.error("No segment id for this group."); return; }
    setSegRunning(segName);
    try {
      const { data, error } = await supabase.functions.invoke("auto-estimate", {
        body: { segment_id: seg, project_id: projectId },
      });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = (data as any)?.metadata?.items_created ?? (data as any)?.items_created ?? 0;
      toast.success(`Segment "${segName}" re-run: ${created} item(s)`);
      await reload();
      state.refresh();
    } catch (err) {
      console.warn("Per-segment re-run failed:", err);
      toast.error(`Re-run failed for "${segName}"`);
    } finally {
      setSegRunning(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const mapped = await loadWorkflowTakeoffRows(projectId, state.files);
      if (cancelled) return;
      setRows(mapped);
      setSelectedId((current) => mapped.find((row) => row.id === current)?.id || mapped[0]?.id || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, state.files]);

  useEffect(() => {
    const focus = state.local.takeoffFocus as {
      raw_id?: string;
      raw_kind?: "legacy" | "canonical";
      source_file_id?: string | null;
      page_number?: number | null;
    } | undefined;
    if (!focus) return;

    const target = rows.find((row) => {
      if (focus.raw_id && focus.raw_kind) return row.raw_id === focus.raw_id && row.raw_kind === focus.raw_kind;
      return !!focus.source_file_id && row.source_file_id === focus.source_file_id;
    });

    if (target && target.id !== selectedId) setSelectedId(target.id);
    if (focus.page_number && focus.page_number > 0) setPdfPage(focus.page_number);
  }, [rows, selectedId, state.local.takeoffFocus]);

  // Resolve signed URL of the source file for the highlighted/selected row
  const focusRow = useMemo(
    () => rows.find((r) => r.id === (hoverId || selectedId)),
    [rows, hoverId, selectedId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fileId = focusRow?.source_file_id || state.files[0]?.id;
      const f = state.files.find((x) => x.id === fileId);
      if (!f) { setSignedUrl(null); return; }
      const { data } = await supabase.storage.from("blueprints").createSignedUrl(f.file_path, 3600);
      if (!cancelled) setSignedUrl(data?.signedUrl || null);
    })();
    return () => { cancelled = true; };
  }, [focusRow?.source_file_id, state.files]);

  useEffect(() => {
    const focus = state.local.takeoffFocus as { page_number?: number | null } | undefined;
    setPdfPage(focus?.page_number && focus.page_number > 0 ? focus.page_number : 1);
    setPdfPageCount(0);
    setPdfImg(null);
  }, [signedUrl, state.local.takeoffFocus]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const files = state.files || [];
      let parsedNow = 0, alreadyIndexed = 0, parseFails = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setGenStatus(`File ${i + 1}/${files.length}: ${f.file_name}`);
        const res = await parseAndIndexFile(projectId, {
          id: f.id,
          legacy_file_id: f.legacy_file_id,
          file_name: f.file_name,
          file_path: f.file_path,
        }, (msg) => setGenStatus(msg));
        if (res.skipped) alreadyIndexed++;
        else if (res.status === "indexed") parsedNow++;
        else parseFails++;
      }
      if (parseFails > 0) toast.warning(`${parseFails} file(s) failed to parse.`);

      setGenStatus("Generating takeoff...");
      const { data: segs, error } = await supabase
        .from("segments").select("id,name").eq("project_id", projectId);
      if (error) throw error;
      const segments = segs || [];
      if (segments.length === 0) {
        toast.error("No approved scope segments found. Approve scope items in Stage 02 first.");
        return;
      }
      let ok = 0, failed = 0, totalItems = 0, manualBlocked = 0;
      for (const seg of segments) {
        try {
          const { data: estData, error: invokeErr } = await supabase.functions.invoke("auto-estimate", {
            body: { segment_id: seg.id, project_id: projectId },
          });
          if (invokeErr) throw invokeErr;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((estData as any)?.blocked && (estData as any)?.reason === "MANUAL_NOT_LOADED") {
            manualBlocked++;
            continue;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const created = (estData as any)?.metadata?.items_created
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?? (estData as any)?.items_created
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?? (Array.isArray((estData as any)?.items) ? (estData as any).items.length : 0);
          totalItems += created || 0;
          ok++;
        } catch (err) {
          console.warn(`auto-estimate failed for segment ${seg.name}:`, err);
          failed++;
        }
      }
      if (manualBlocked > 0 && ok === 0) {
        toast.error("Manual-Standard-Practice-2018 not loaded in Brain. Upload it (with extracted text) before running takeoff.");
      } else if (ok > 0 && totalItems > 0) {
        toast.success(`Generated ${totalItems} item(s) across ${ok} segment(s)${failed ? ` (${failed} failed)` : ""}`);
      } else if (ok > 0) {
        toast.warning("0 items generated — drawings may lack rebar data.");
      } else {
        toast.error("Takeoff generation failed for all segments.");
      }
      await reload();
      state.refresh();
    } finally {
      setGenerating(false);
      setGenStatus("");
    }
  };

  const beginEdit = (r: WorkflowTakeoffRow) => {
    setEditingId(r.id);
    setEditPatch({ count: r.count, length: r.length, weight: r.weight, size: r.size });
  };
  const cancelEdit = () => { setEditingId(null); setEditPatch({}); };

  const saveEdit = async (r: WorkflowTakeoffRow) => {
    if (r.raw_kind !== "legacy") {
      toast.error("Editing canonical takeoff items not supported here yet.");
      return;
    }
    const patch: Record<string, unknown> = {};
    const original: Record<string, unknown> = { count: r.count, length: r.length, weight: r.weight, size: r.size };
    const next: Record<string, unknown> = {};
    let nextGeometryStatus: WorkflowTakeoffRow["geometry_status"] | null = null;
    if (editPatch.count !== undefined && editPatch.count !== r.count) { patch.quantity_count = editPatch.count; next.count = editPatch.count; }
    if (editPatch.length !== undefined && editPatch.length !== r.length) { patch.total_length = editPatch.length; next.length = editPatch.length; }
    if (editPatch.weight !== undefined && editPatch.weight !== r.weight) { patch.total_weight = editPatch.weight; next.weight = editPatch.weight; }
    if (editPatch.size !== undefined && editPatch.size !== r.size) { patch.bar_size = editPatch.size; next.size = editPatch.size; }
    if (Object.keys(patch).length === 0) { cancelEdit(); return; }

    if (patch.quantity_count !== undefined || patch.total_length !== undefined || patch.total_weight !== undefined) {
      const { data: item } = await supabase.from("estimate_items").select("assumptions_json").eq("id", r.raw_id).maybeSingle();
      const assumptions = item?.assumptions_json && typeof item.assumptions_json === "object" && !Array.isArray(item.assumptions_json)
        ? item.assumptions_json as Record<string, unknown>
        : {};
      const nextCount = Number(patch.quantity_count ?? r.count);
      const nextLength = Number(patch.total_length ?? r.length);
      const nextWeight = Number(patch.total_weight ?? r.weight);
      nextGeometryStatus = nextCount > 0 && (nextLength > 0 || nextWeight > 0) ? "resolved" : "partial";
      patch.assumptions_json = {
        ...assumptions,
        geometry_status: nextGeometryStatus,
        missing_refs: nextGeometryStatus === "resolved" ? [] : assumptions.missing_refs,
        manual_takeoff_answered_at: new Date().toISOString(),
      };
    }

    const { error } = await supabase.from("estimate_items").update(patch).eq("id", r.raw_id);
    if (error) { toast.error("Save failed: " + error.message); return; }

    if (user) {
      await supabase.from("audit_events").insert({
        user_id: user.id,
        project_id: projectId,
        segment_id: r.segment_id,
        entity_type: "estimate_item",
        entity_id: r.raw_id,
        action: "ocr_correction",
        metadata: { original, corrected: next, source: "takeoff_stage", file_id: r.source_file_id },
      } as any);
    }

    setRows((prev) => prev.map((row) => row.id === r.id ? {
      ...row,
      ...(next as Partial<WorkflowTakeoffRow>),
      geometry_status: nextGeometryStatus || row.geometry_status,
      missing_refs: nextGeometryStatus === "resolved" ? [] : row.missing_refs,
      status: patch.assumptions_json ? "review" : row.status,
    } as WorkflowTakeoffRow : row));
    cancelEdit();
    toast.success("OCR correction saved & logged");
  };

  // Group rows by segment_name
  const groups = useMemo(() => {
    const map = new Map<string, WorkflowTakeoffRow[]>();
    for (const r of rows) {
      const key = r.segment_name || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).map(([name, items]) => ({
      name,
      items,
      weight: items.reduce((s, r) => s + r.weight, 0),
      blocked: items.filter((r) => r.status === "blocked").length,
    }));
  }, [rows]);

  const totals = useMemo(() => ({
    rows: rows.length,
    weight: rows
      .filter((r) => r.geometry_status !== "unresolved")
      .reduce((s, r) => s + r.weight, 0),
    blocked: rows.filter(
      (r) => r.status === "blocked" || r.geometry_status === "unresolved"
    ).length,
  }), [rows]);

  const sel = focusRow;
  const previewFileId = sel?.source_file_id || state.files[0]?.id;
  const previewFile = state.files.find((f) => f.id === previewFileId);
  const previewName = previewFile?.file_name || "";
  const isImg = /\.(png|jpe?g|webp|gif|svg)$/i.test(previewName);
  const isPdf = /\.pdf$/i.test(previewName);

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: "240px 1fr 380px" }}>
      <aside className="border-r border-border flex flex-col min-h-0" style={{ background: "hsl(var(--card))" }}>
        <div className="px-3 h-10 flex items-center border-b border-border">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
            <Sparkles className="w-3.5 h-3.5 text-primary" /> Segments
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1 text-[12px]">
          {groups.length === 0 ? (
            <div className="text-[11px] text-muted-foreground p-2">No segments yet.</div>
          ) : groups.map((g) => (
            <button key={g.name}
              onClick={() => {
                const first = g.items[0];
                if (first) setSelectedId(first.id);
                setCollapsed((c) => ({ ...c, [g.name]: false }));
              }}
              className="w-full ip-card p-2 text-left hover:bg-accent/40">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold truncate">{g.name}</div>
                {g.blocked > 0 && <Pill tone="blocked" solid>{g.blocked}</Pill>}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                {g.items.length} rows · {g.weight.toFixed(0)} kg
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); runSingleSegment(g.name); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); runSingleSegment(g.name); } }}
                className={`mt-1.5 inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 border ${segRunning === g.name ? "border-muted-foreground/30 text-muted-foreground" : "border-primary/40 text-primary hover:bg-primary/10"}`}
              >
                {segRunning === g.name ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Wand2 className="w-2.5 h-2.5" />}
                {segRunning === g.name ? "Running…" : "Re-run segment"}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <div className="border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 03 - Production Takeoff Data"
          title="Takeoff Workspace · By Segment"
          right={<div className="flex gap-2">
            <Pill tone="direct">{totals.rows} ROWS</Pill>
            <Pill tone="supported">{totals.weight.toFixed(0)} KG</Pill>
            {totals.blocked > 0 && <Pill tone="blocked" solid>{totals.blocked} BLOCKED</Pill>}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 border border-primary text-primary text-[10px] font-mono uppercase tracking-wider hover:bg-primary/10 disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              {generating ? (genStatus || "Generating…") : rows.length === 0 ? "Generate Takeoff" : "Re-run"}
            </button>
          </div>}
        />
        <div className="flex-1 overflow-auto">
          {loading ? <EmptyState title="Loading takeoff..." /> :
            rows.length === 0 ? <EmptyState title="No takeoff rows" hint='Approve scope items in Stage 02, then click "Generate Takeoff" above.' /> : (
              <div>
                {groups.map((g) => {
                  const isCollapsed = collapsed[g.name];
                  return (
                    <div key={g.name} className="border-b border-border">
                      <button
                        onClick={() => setCollapsed((c) => ({ ...c, [g.name]: !c[g.name] }))}
                        className="w-full flex items-center gap-2 px-3 h-8 bg-muted/40 text-left hover:bg-muted/60"
                      >
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{g.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                          {g.items.length} · {g.weight.toFixed(0)} kg
                        </span>
                      </button>
                      {!isCollapsed && (
                        <table className="w-full text-[12px] tabular-nums">
                          <thead className="bg-muted/20 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            <tr>
                              <th className="text-left px-3 h-7 w-20">Mark</th>
                              <th className="text-left px-3 h-7 w-16">Size</th>
                              <th className="text-left px-3 h-7">Shape</th>
                              <th className="text-right px-3 h-7 w-16">Qty</th>
                              <th className="text-right px-3 h-7 w-20">Length</th>
                              <th className="text-right px-3 h-7 w-20">Weight</th>
                              <th className="text-left px-3 h-7 w-24">Status</th>
                              <th className="text-right px-3 h-7 w-16"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.items.map((r, i) => {
                              const editing = editingId === r.id;
                              const foundDisplay = extractFoundDisplay(r);
                              return (
                                <tr key={r.id}
                                  onMouseEnter={() => setHoverId(r.id)}
                                  onMouseLeave={() => setHoverId(null)}
                                  onClick={() => setSelectedId(r.id)}
                                  className={`border-t border-border cursor-pointer ${selectedId === r.id ? "bg-primary/10" : i % 2 ? "bg-card/30 hover:bg-accent/40" : "hover:bg-accent/40"}`}>
                                  <td className="px-3 font-mono text-[hsl(var(--status-direct))]">{r.mark}</td>
                                  <td className="px-3">
                                    {editing ? (
                                      <input className="w-14 bg-background border border-border px-1 text-[11px]"
                                        value={editPatch.size ?? ""} onChange={(e) => setEditPatch((p) => ({ ...p, size: e.target.value }))} />
                                    ) : r.size}
                                  </td>
                                  <td className="px-3 truncate max-w-0">{r.shape}</td>
                                  <td className="px-3 text-right">
                                    {editing ? (
                                      <input type="number" className="w-16 bg-background border border-border px-1 text-[11px] text-right"
                                        value={editPatch.count ?? 0} onChange={(e) => setEditPatch((p) => ({ ...p, count: Number(e.target.value) }))} />
                                    ) : r.geometry_status === "unresolved" ? <UnresolvedValue value={foundDisplay.qty} /> : r.count}
                                  </td>
                                  <td className="px-3 text-right">
                                    {editing ? (
                                      <input type="number" step="0.01" className="w-20 bg-background border border-border px-1 text-[11px] text-right"
                                        value={editPatch.length ?? 0} onChange={(e) => setEditPatch((p) => ({ ...p, length: Number(e.target.value) }))} />
                                    ) : r.geometry_status === "unresolved" ? <UnresolvedValue value={foundDisplay.length} /> : r.length.toFixed(2)}
                                  </td>
                                  <td className="px-3 text-right font-semibold">
                                    {editing ? (
                                      <input type="number" step="0.1" className="w-20 bg-background border border-border px-1 text-[11px] text-right"
                                        value={editPatch.weight ?? 0} onChange={(e) => setEditPatch((p) => ({ ...p, weight: Number(e.target.value) }))} />
                                    ) : r.geometry_status === "unresolved" ? <UnresolvedValue value={foundDisplay.weight} /> : r.weight.toFixed(1)}
                                  </td>
                                  <td className="px-3">
                                    {r.geometry_status === "unresolved" ? (
                                      <Pill tone="blocked" solid>
                                        <span title={r.missing_refs.length ? `Missing: ${r.missing_refs.join("; ")}` : "Geometry unresolved"}>Unresolved</span>
                                      </Pill>
                                    ) : r.geometry_status === "partial" ? (
                                      <Pill tone="inferred" solid>
                                        <span title={r.missing_refs.length ? `Missing: ${r.missing_refs.join("; ")}` : "Partial geometry"}>Partial</span>
                                      </Pill>
                                    ) : r.status === "ready" ? <Pill tone="direct" solid>Resolved</Pill>
                                      : r.status === "blocked" ? <Pill tone="blocked" solid>Blocked</Pill>
                                      : <Pill tone="direct" solid>Resolved</Pill>}
                                  </td>
                                  <td className="px-3 text-right" onClick={(e) => e.stopPropagation()}>
                                    {editing ? (
                                      <div className="inline-flex gap-1">
                                        <button onClick={() => saveEdit(r)} title="Save" className="p-1 text-primary hover:bg-primary/10"><Save className="w-3.5 h-3.5" /></button>
                                        <button onClick={cancelEdit} title="Cancel" className="p-1 text-muted-foreground hover:bg-muted"><X className="w-3.5 h-3.5" /></button>
                                      </div>
                                    ) : (
                                      r.raw_kind === "legacy" && (
                                        <button onClick={() => beginEdit(r)} title="Fix OCR" className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10">
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                      )
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      </div>

      <aside className="flex flex-col min-h-0" style={{ background: "hsl(var(--card))" }}>
        <div className="border-b border-border">
          <StageHeader kicker="Drawing Evidence" title={sel ? `${sel.segment_name} · ${sel.mark}` : "Hover a row"} />
        </div>
        <div className="flex-1 overflow-auto bg-white text-neutral-900">
          {!previewFile ? <EmptyState title="No drawings uploaded" /> : !signedUrl ? (
            <div className="h-full flex items-center justify-center text-[10px] text-neutral-400 font-mono uppercase tracking-widest p-4 text-center">
              Loading drawing…
            </div>
          ) : isImg ? (
            <img src={signedUrl} alt="" className="w-full h-auto" />
          ) : isPdf ? (
            <div className="flex flex-col h-full p-2">
              <PdfRenderer
                url={signedUrl}
                currentPage={pdfPage}
                scale={1.5}
                onPageCount={setPdfPageCount}
                onPageRendered={(img) => setPdfImg(img)}
              />
              {pdfImg ? (
                <img src={pdfImg} alt="drawing" className="w-full h-auto border border-neutral-200" />
              ) : (
                <div className="text-[10px] text-neutral-400 font-mono p-3">Rendering page {pdfPage}…</div>
              )}
              {pdfPageCount > 1 && (
                <div className="flex items-center justify-between mt-2 text-[10px] font-mono">
                  <button onClick={() => setPdfPage((p) => Math.max(1, p - 1))} disabled={pdfPage <= 1}
                    className="px-2 py-1 border border-neutral-300 disabled:opacity-30">‹ Prev</button>
                  <span className="text-neutral-500">Page {pdfPage} / {pdfPageCount}</span>
                  <button onClick={() => setPdfPage((p) => Math.min(pdfPageCount, p + 1))} disabled={pdfPage >= pdfPageCount}
                    className="px-2 py-1 border border-neutral-300 disabled:opacity-30">Next ›</button>
                </div>
              )}
              <a href={signedUrl} target="_blank" rel="noreferrer"
                className="mt-2 text-[10px] font-mono uppercase tracking-wider text-blue-600 hover:underline text-center">
                Open in new tab ↗
              </a>
            </div>
          ) : (
            <a href={signedUrl} target="_blank" rel="noreferrer"
              className="block p-3 text-[10px] font-mono uppercase tracking-wider text-blue-600 hover:underline">
              Open file in new tab ↗
            </a>
          )}
        </div>
        {sel && (
          <div className="border-t border-border p-3 bg-card text-foreground">
            {sel.geometry_status === "unresolved" && (
              <UnresolvedFoundPanel row={sel} />
            )}
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono mb-3">
              {sel.geometry_status === "unresolved" ? (
                <>
                  <Field label="Qty" value={extractFoundDisplay(sel).qty} />
                  <Field label="Len" value={extractFoundDisplay(sel).length} />
                  <Field label="Wt" value={extractFoundDisplay(sel).weight} />
                </>
              ) : (
                <>
                  <Field label="Qty" value={String(sel.count)} />
                  <Field label="Len (m)" value={sel.length.toFixed(2)} />
                  <Field label="Wt (kg)" value={sel.weight.toFixed(1)} />
                </>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <FileText className="w-3.5 h-3.5" />
              <span className="truncate">{sel.source}</span>
            </div>
          </div>
        )}
        <div className="border-t border-border p-3">
          <button
            disabled={rows.length === 0 || totals.blocked > 0}
            onClick={() => { state.refresh(); goToStage?.("qa"); }}
            className="w-full h-10 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground text-[12px] font-semibold uppercase tracking-[0.14em] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-4 h-4" />
            {totals.blocked > 0 ? `${totals.blocked} Blocked — Resolve First` : "Confirm Takeoff Data"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-background px-2 py-1.5">
      <div className="ip-kicker">{label}</div>
      <div className="truncate text-[12px] tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function UnresolvedValue({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center justify-end text-[11px] font-semibold text-[hsl(var(--status-inferred))]" title={value}>
      {value}
    </span>
  );
}

function UnresolvedFoundPanel({ row }: { row: WorkflowTakeoffRow }) {
  const display = extractFoundDisplay(row);
  return (
    <div className="mb-3 border border-[hsl(var(--status-inferred))]/50 bg-[hsl(var(--status-inferred))]/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="ip-kicker">Found / Confirmation Needed</div>
        <Pill tone={display.confidence === "high" ? "ok" : display.confidence === "medium" ? "warn" : "bad"}>
          Evidence {display.confidence}
        </Pill>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-foreground">{display.found}</p>
      <p className="mt-2 border-l border-primary/50 pl-2 text-[12px] leading-relaxed text-muted-foreground">
        {display.question}
      </p>
      {row.missing_refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.missing_refs.map((ref) => <Pill key={ref} tone="blocked">{ref.replace(/_/g, " ")}</Pill>)}
        </div>
      )}
    </div>
  );
}
