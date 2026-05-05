import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { StageHeader, EmptyState, type StageProps } from "./_shared";
import { CheckCircle2, RotateCcw, Send } from "lucide-react";

interface ConfirmRow {
  id: string;
  label: string;
  extracted: string;
  decision: "approved" | "corrected" | "returned" | "pending";
}

export default function ConfirmStage({ projectId, state }: StageProps) {
  const [rows, setRows] = useState<ConfirmRow[]>([]);
  const [chat, setChat] = useState<Array<{ role: "estimator" | "system"; text: string; ts: string }>>(() =>
    (state.local.confirmChat as any) || []
  );
  const [draft, setDraft] = useState("");
  const [selectedFileId, setSelectedFileId] = useState<string | null>(state.files[0]?.id || null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("estimate_items")
        .select("id, description, bar_size, total_weight")
        .eq("project_id", projectId).limit(50);
      const mapped: ConfirmRow[] = (data || []).map((d: any, i: number) => ({
        id: d.id,
        label: `${d.bar_size || "—"} · ${d.description || `Item ${i + 1}`}`.slice(0, 60),
        extracted: `${(Number(d.total_weight || 0)).toFixed(1)} kg`,
        decision: (state.local.confirmRows?.[d.id] as any) || "pending",
      }));
      setRows(mapped);
    })();
  }, [projectId]);

  useEffect(() => {
    (async () => {
      const f = state.files.find((x) => x.id === selectedFileId);
      if (!f) { setSignedUrl(null); return; }
      const { data } = await supabase.storage.from("blueprints").createSignedUrl(f.file_path, 3600);
      setSignedUrl(data?.signedUrl || null);
    })();
  }, [selectedFileId, state.files]);

  const setDecision = (id: string, decision: ConfirmRow["decision"]) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, decision } : r)));
    state.setLocal({ confirmRows: { ...(state.local.confirmRows || {}), [id]: decision } });
  };

  const sendMsg = () => {
    if (!draft.trim()) return;
    const next = [...chat, { role: "estimator" as const, text: draft.trim(), ts: new Date().toISOString() }];
    setChat(next); state.setLocal({ confirmChat: next }); setDraft("");
  };

  const finalize = () => {
    const pending = rows.filter((r) => r.decision === "pending").length;
    if (rows.length > 0 && pending > 0) { toast.error(`${pending} rows still pending`); return; }
    state.setLocal({ estimatorConfirmed: true, estimatorConfirmedAt: new Date().toISOString() });
    toast.success("Estimator signoff recorded — Outputs unlocked");
    state.refresh();
  };
  const returnToQA = () => {
    state.setLocal({ estimatorConfirmed: false });
    toast.message("Returned to QA Gate");
  };

  const file = state.files.find((f) => f.id === selectedFileId);
  const isImg = file && /\.(png|jpe?g|webp|gif|svg)$/i.test(file.file_name);

  return (
    <div className="grid grid-cols-12 h-full">
      <div className="col-span-7 border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 05 · Required"
          title="Estimator Confirmation"
          subtitle="Pre-finalization checkpoint. Outputs remain locked until signoff is recorded."
          right={<div className="flex gap-2">
            <button onClick={returnToQA} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider border border-yellow-500/40 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10">
              <RotateCcw className="w-3 h-3" /> Return to QA
            </button>
            <button onClick={finalize} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider border border-primary text-primary-foreground bg-primary hover:opacity-90">
              <CheckCircle2 className="w-3 h-3" /> Confirm Signoff
            </button>
          </div>}
        />
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <EmptyState title="Nothing to confirm yet" hint="Complete takeoff and QA, then return here for signoff." />
          ) : (
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-left px-3 py-2 w-28">Extracted</th>
                  <th className="text-left px-3 py-2 w-44">Estimator Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-1.5 truncate max-w-0">{r.label}</td>
                    <td className="px-3 py-1.5">{r.extracted}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-1">
                        <DecBtn label="Approve" active={r.decision === "approved"} tone="ok" onClick={() => setDecision(r.id, "approved")} />
                        <DecBtn label="Correct" active={r.decision === "corrected"} tone="info" onClick={() => setDecision(r.id, "corrected")} />
                        <DecBtn label="Return" active={r.decision === "returned"} tone="warn" onClick={() => setDecision(r.id, "returned")} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-border flex flex-col" style={{ height: 220 }}>
          <div className="px-3 py-1.5 border-b border-border bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">Review Chat (audit trail)</div>
          <div className="flex-1 overflow-auto p-3 space-y-2 text-xs">
            {chat.length === 0 ? <div className="text-muted-foreground">No notes yet.</div> :
              chat.map((m, i) => (
                <div key={i} className="border-l-2 border-primary/40 pl-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{m.role} · {new Date(m.ts).toLocaleTimeString()}</div>
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
          <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-mono">Drawing Evidence</div>
          <select value={selectedFileId || ""} onChange={(e) => setSelectedFileId(e.target.value)}
            className="text-xs bg-white border border-neutral-300 px-2 py-1 font-mono">
            <option value="">Select file</option>
            {state.files.map((f) => <option key={f.id} value={f.id}>{f.file_name}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {!signedUrl ? (
            <div className="h-full flex items-center justify-center text-xs text-neutral-400 font-mono uppercase tracking-widest">No drawing</div>
          ) : isImg ? (
            <img src={signedUrl} alt="" className="w-full h-auto border border-neutral-200" />
          ) : (
            <iframe src={signedUrl} title="drawing" className="w-full h-full border border-neutral-200" />
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