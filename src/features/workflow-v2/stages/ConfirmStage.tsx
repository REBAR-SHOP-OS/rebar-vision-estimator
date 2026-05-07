import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { StageHeader, EmptyState, type StageProps } from "./_shared";
import { CheckCircle2, RotateCcw, Send, Pencil, Save, X, ChevronDown, ChevronRight } from "lucide-react";
import PdfRenderer from "@/components/chat/PdfRenderer";
import {
  clearWorkflowEstimatorSignoff,
  loadWorkflowTakeoffRows,
  saveWorkflowEstimatorSignoff,
  type WorkflowTakeoffRow,
} from "../takeoff-data";

interface ConfirmRow {
  id: string;
  raw: WorkflowTakeoffRow;
  decision: "approved" | "corrected" | "returned" | "pending";
}

export default function ConfirmStage({ projectId, state, goToStage }: StageProps) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ConfirmRow[]>([]);
  const [chat, setChat] = useState<Array<{ role: "estimator" | "system"; text: string; ts: string }>>(() =>
    (state.local.confirmChat as Array<{ role: "estimator" | "system"; text: string; ts: string }>) || []
  );
  const [draft, setDraft] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPatch, setEditPatch] = useState<{ count?: number; length?: number; weight?: number; size?: string }>({});
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfImg, setPdfImg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const takeoffRows = await loadWorkflowTakeoffRows(projectId, state.files);
      if (cancelled) return;
      const decisions = (state.local.confirmRows || {}) as Record<string, ConfirmRow["decision"]>;
      setRows(takeoffRows.map((row) => ({
        id: row.id,
        raw: row,
        decision: decisions[row.id] || "pending",
      })));
      setSelectedRowId((cur) => cur || takeoffRows[0]?.id || null);
    })();
    return () => { cancelled = true; };
  }, [projectId, state.files, state.local.confirmRows]);

  const selectedRow = rows.find((r) => r.id === selectedRowId)?.raw || null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fileId = selectedRow?.source_file_id || state.files[0]?.id;
      const f = state.files.find((x) => x.id === fileId);
      if (!f) { setSignedUrl(null); return; }
      const { data } = await supabase.storage.from("blueprints").createSignedUrl(f.file_path, 3600);
      if (!cancelled) setSignedUrl(data?.signedUrl || null);
    })();
    return () => { cancelled = true; };
  }, [selectedRow?.source_file_id, state.files]);

  const setDecision = (id: string, decision: ConfirmRow["decision"]) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, decision } : r)));
    state.setLocal({ confirmRows: { ...((state.local.confirmRows as any) || {}), [id]: decision } });
  };

  const beginEdit = (r: ConfirmRow) => {
    setEditingId(r.id);
    setEditPatch({ count: r.raw.count, length: r.raw.length, weight: r.raw.weight, size: r.raw.size });
  };
  const cancelEdit = () => { setEditingId(null); setEditPatch({}); };

  const saveEdit = async (r: ConfirmRow) => {
    if (r.raw.raw_kind !== "legacy") { toast.error("Cannot edit canonical rows here."); return; }
    const patch: Record<string, unknown> = {};
    const original = { count: r.raw.count, length: r.raw.length, weight: r.raw.weight, size: r.raw.size };
    const next: Record<string, unknown> = {};
    if (editPatch.count !== undefined && editPatch.count !== r.raw.count) { patch.quantity_count = editPatch.count; next.count = editPatch.count; }
    if (editPatch.length !== undefined && editPatch.length !== r.raw.length) { patch.total_length = editPatch.length; next.length = editPatch.length; }
    if (editPatch.weight !== undefined && editPatch.weight !== r.raw.weight) { patch.total_weight = editPatch.weight; next.weight = editPatch.weight; }
    if (editPatch.size !== undefined && editPatch.size !== r.raw.size) { patch.bar_size = editPatch.size; next.size = editPatch.size; }
    if (Object.keys(patch).length === 0) { cancelEdit(); return; }
    const { error } = await supabase.from("estimate_items").update(patch).eq("id", r.raw.raw_id);
    if (error) { toast.error("Save failed: " + error.message); return; }
    if (user) {
      await supabase.from("audit_events").insert({
        user_id: user.id, project_id: projectId, segment_id: r.raw.segment_id,
        entity_type: "estimate_item", entity_id: r.raw.raw_id, action: "ocr_correction",
        metadata: { original, corrected: next, source: "confirm_stage", file_id: r.raw.source_file_id },
      } as any);
    }
    setRows((prev) => prev.map((row) => row.id === r.id
      ? { ...row, raw: { ...row.raw, ...(next as Partial<WorkflowTakeoffRow>) } as WorkflowTakeoffRow, decision: "corrected" }
      : row));
    state.setLocal({ confirmRows: { ...((state.local.confirmRows as any) || {}), [r.id]: "corrected" } });
    cancelEdit();
    toast.success("Correction saved & logged");
  };

  const sendMsg = () => {
    if (!draft.trim()) return;
    const next = [...chat, { role: "estimator" as const, text: draft.trim(), ts: new Date().toISOString() }];
    setChat(next);
    state.setLocal({ confirmChat: next });
    setDraft("");
  };

  const finalize = async () => {
    if (rows.length === 0) {
      toast.error("No takeoff rows to confirm. Complete Takeoff stage first.");
      return;
    }
    const pending = rows.filter((r) => r.decision === "pending").length;
    if (pending > 0) {
      toast.error(`${pending} rows still pending`);
      return;
    }
    if (!user) {
      toast.error("Sign in required to record estimator signoff");
      return;
    }

    setSaving(true);
    const { error } = await saveWorkflowEstimatorSignoff(projectId, user.id);
    setSaving(false);
    if (error) {
      toast.error("Failed to record estimator signoff");
      return;
    }

    state.setLocal({ estimatorConfirmed: true, estimatorConfirmedAt: new Date().toISOString() });
    toast.success("Estimator signoff recorded - Outputs unlocked");
    state.refresh();
    goToStage?.("outputs");
  };

  const returnToQA = async () => {
    setSaving(true);
    const { error } = await clearWorkflowEstimatorSignoff(projectId);
    setSaving(false);
    if (error) {
      toast.error("Failed to clear signoff");
      return;
    }
    state.setLocal({ estimatorConfirmed: false });
    toast.message("Returned to QA Gate");
    state.refresh();
    goToStage?.("qa");
  };

  const fileId = selectedRow?.source_file_id || state.files[0]?.id;
  const file = state.files.find((f) => f.id === fileId);
  const isImg = file && /\.(png|jpe?g|webp|gif|svg)$/i.test(file.file_name);
  const isPdf = file && /\.pdf$/i.test(file.file_name);

  useEffect(() => {
    setPdfPage(1);
    setPdfPageCount(0);
    setPdfImg(null);
  }, [signedUrl]);

  // Group rows by segment_name
  const groups = (() => {
    const map = new Map<string, ConfirmRow[]>();
    for (const r of rows) {
      const key = r.raw.segment_name || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).map(([name, items]) => ({
      name, items,
      pending: items.filter((i) => i.decision === "pending").length,
      approved: items.filter((i) => i.decision === "approved").length,
    }));
  })();

  return (
    <div className="grid grid-cols-12 h-full">
      <div className="col-span-7 border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 06 - Required"
          title="Estimator Confirmation · By Segment"
          subtitle="Review every segment. Hover/click a row to inspect the source drawing on the right."
          right={<div className="flex gap-2">
            <button
              disabled={saving}
              onClick={returnToQA}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider border border-yellow-500/40 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" /> Return to QA
            </button>
            <button
              disabled={saving}
              onClick={finalize}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider border border-primary text-primary-foreground bg-primary hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle2 className="w-3 h-3" /> Confirm Signoff
            </button>
          </div>}
        />
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <EmptyState title="Nothing to confirm yet" hint="Complete takeoff and QA, then return here for signoff." />
          ) : groups.map((g) => {
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
                    {g.approved}/{g.items.length} approved · {g.pending} pending
                  </span>
                </button>
                {!isCollapsed && (
                  <table className="w-full text-xs font-mono">
                    <thead className="bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-1.5 w-20">Mark</th>
                        <th className="text-left px-3 py-1.5 w-14">Size</th>
                        <th className="text-right px-3 py-1.5 w-14">Qty</th>
                        <th className="text-right px-3 py-1.5 w-20">Len</th>
                        <th className="text-right px-3 py-1.5 w-20">Wt(kg)</th>
                        <th className="text-left px-3 py-1.5 w-44">Decision</th>
                        <th className="text-right px-3 py-1.5 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((r) => {
                        const editing = editingId === r.id;
                        return (
                          <tr key={r.id}
                            onClick={() => setSelectedRowId(r.id)}
                            className={`border-t border-border cursor-pointer ${selectedRowId === r.id ? "bg-primary/10" : ""}`}>
                            <td className="px-3 py-1.5">{r.raw.mark}</td>
                            <td className="px-3 py-1.5">
                              {editing ? <input className="w-12 bg-background border border-border px-1" value={editPatch.size ?? ""} onChange={(e) => setEditPatch((p) => ({ ...p, size: e.target.value }))} /> : r.raw.size}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {editing ? <input type="number" className="w-14 bg-background border border-border px-1 text-right" value={editPatch.count ?? 0} onChange={(e) => setEditPatch((p) => ({ ...p, count: Number(e.target.value) }))} /> : r.raw.count}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {editing ? <input type="number" step="0.01" className="w-20 bg-background border border-border px-1 text-right" value={editPatch.length ?? 0} onChange={(e) => setEditPatch((p) => ({ ...p, length: Number(e.target.value) }))} /> : r.raw.length.toFixed(2)}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {editing ? <input type="number" step="0.1" className="w-20 bg-background border border-border px-1 text-right" value={editPatch.weight ?? 0} onChange={(e) => setEditPatch((p) => ({ ...p, weight: Number(e.target.value) }))} /> : r.raw.weight.toFixed(1)}
                            </td>
                            <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-1">
                                <DecBtn label="Approve" active={r.decision === "approved"} tone="ok" onClick={() => setDecision(r.id, "approved")} />
                                <DecBtn label="Correct" active={r.decision === "corrected"} tone="info" onClick={() => setDecision(r.id, "corrected")} />
                                <DecBtn label="Return" active={r.decision === "returned"} tone="warn" onClick={() => setDecision(r.id, "returned")} />
                              </div>
                            </td>
                            <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                              {r.raw.raw_kind === "legacy" && (editing ? (
                                <span className="inline-flex gap-1">
                                  <button onClick={() => saveEdit(r)} className="p-1 text-primary hover:bg-primary/10"><Save className="w-3 h-3" /></button>
                                  <button onClick={cancelEdit} className="p-1 text-muted-foreground"><X className="w-3 h-3" /></button>
                                </span>
                              ) : (
                                <button onClick={() => beginEdit(r)} className="p-1 text-muted-foreground hover:text-primary"><Pencil className="w-3 h-3" /></button>
                              ))}
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
        <div className="border-t border-border flex flex-col" style={{ height: 220 }}>
          <div className="px-3 py-1.5 border-b border-border bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">Review Chat (audit trail)</div>
          <div className="flex-1 overflow-auto p-3 space-y-2 text-xs">
            {chat.length === 0 ? <div className="text-muted-foreground">No notes yet.</div> :
              chat.map((m, i) => (
                <div key={i} className="border-l-2 border-primary/40 pl-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{m.role} - {new Date(m.ts).toLocaleTimeString()}</div>
                  <div>{m.text}</div>
                </div>
              ))}
          </div>
          <div className="flex border-t border-border">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMsg()}
              placeholder="Add estimator note..." className="flex-1 px-3 py-2 text-xs bg-background outline-none" />
            <button onClick={sendMsg} className="px-3 border-l border-border text-xs font-mono uppercase hover:bg-muted">
              <Send className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="col-span-5 flex flex-col min-h-0 bg-white text-neutral-900">
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-neutral-50">
          <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-mono">
            Drawing Evidence {selectedRow ? `· ${selectedRow.segment_name} · ${selectedRow.mark}` : ""}
          </div>
          <span className="text-[10px] font-mono text-neutral-500 truncate max-w-[200px]">{file?.file_name || "—"}</span>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {!signedUrl ? (
            <div className="h-full flex items-center justify-center text-xs text-neutral-400 font-mono uppercase tracking-widest text-center">
              {file ? "Loading…" : "No drawings uploaded yet"}
            </div>
          ) : isImg ? (
            <img src={signedUrl} alt="" className="w-full h-auto border border-neutral-200" />
          ) : isPdf ? (
            <div className="flex flex-col h-full">
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
                className="mt-2 text-[10px] font-mono uppercase tracking-wider text-blue-600 hover:underline">
                Open in new tab ↗
              </a>
            </div>
          ) : (
            <a href={signedUrl} target="_blank" rel="noreferrer"
              className="text-[10px] font-mono uppercase tracking-wider text-blue-600 hover:underline">
              Open file in new tab ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function DecBtn({ label, onClick, active, tone }: { label: string; onClick: () => void; active: boolean; tone: "ok" | "info" | "warn" }) {
  const base = "px-2 py-1 text-[10px] font-mono uppercase tracking-wider border";
  const cls = {
    ok: active ? "bg-primary text-primary-foreground border-primary" : "border-primary/40 text-primary hover:bg-primary/10",
    info: active ? "bg-blue-600 text-white border-blue-600" : "border-blue-500/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10",
    warn: active ? "bg-yellow-500 text-white border-yellow-500" : "border-yellow-500/40 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10",
  }[tone];
  return <button onClick={onClick} className={`${base} ${cls}`}>{label}</button>;
}
