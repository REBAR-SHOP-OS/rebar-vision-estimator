import { Lock, RefreshCw, Upload, Download } from "lucide-react";
import { StageHeader, Pill, GateBanner, type StageProps } from "./_shared";

const DELIVERABLES = [
  { key: "estimate", kicker: "Internal Document", label: "Estimate Workbook", status: "approved" },
  { key: "quote", kicker: "Client Facing", label: "Quote Package", status: "pending" },
  { key: "review", kicker: "Internal Audit", label: "Review Draft", status: "blocked" },
  { key: "fab", kicker: "Production", label: "Fabrication Output", status: "finalized" },
] as const;

function statusPill(status: string) {
  switch (status) {
    case "approved": return <Pill tone="supported" solid>Approved</Pill>;
    case "pending": return <Pill tone="inferred" solid>Pending</Pill>;
    case "blocked": return <Pill tone="blocked" solid>Blocked</Pill>;
    case "finalized": return <Pill tone="direct" solid>Finalized</Pill>;
    default: return <Pill>—</Pill>;
  }
}

export default function OutputsStage({ state }: StageProps) {
  const unlocked = state.estimatorConfirmed;
  return (
    <div className="flex flex-col h-full">
      <StageHeader
        kicker="Stage 06"
        title="Project Deliverables"
        subtitle="Manage and generate estimation packages for submission."
        right={
          <div className="flex gap-2">
            <button disabled={!unlocked} className="h-8 px-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] border border-border hover:bg-accent/40 disabled:opacity-40">
              <RefreshCw className="w-3.5 h-3.5" /> Sync All
            </button>
            <button disabled={!unlocked} className="h-8 px-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40">
              <Upload className="w-3.5 h-3.5" /> Export All
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {!unlocked && (
          <GateBanner
            tone="blocked"
            title="Export Blocked: Estimator Confirmation Required"
            message="Complete Stage 05 to unlock all deliverables. No exports are produced before signoff."
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {DELIVERABLES.map((d) => (
            <div key={d.key} className="ip-card p-4 flex flex-col gap-3 min-h-[200px]">
              <div className="flex items-start justify-between">
                <div>
                  <div className="ip-kicker">{d.kicker}</div>
                  <div className="text-[15px] font-semibold leading-tight mt-1">{d.label}</div>
                </div>
                {statusPill(d.status)}
              </div>
              <div className="flex-1 grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="ip-kicker">Source Version</div>
                  <div className="font-mono mt-0.5">v4.1.0-RC</div>
                </div>
                <div>
                  <div className="ip-kicker">Status</div>
                  <div className="mt-0.5 text-muted-foreground">{d.status === "approved" ? "● Current" : d.status === "blocked" ? "⊘ Outdated" : d.status === "finalized" ? "✓ Verified" : "● Stale"}</div>
                </div>
                <div className="col-span-2">
                  <div className="ip-kicker">Last Generated</div>
                  <div className="mt-0.5 tabular-nums">{unlocked ? "Today, 09:42 AM" : "—"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button disabled={!unlocked || d.status === "blocked"} className="h-8 text-[10px] font-semibold uppercase tracking-[0.12em] border border-border hover:bg-accent/40 disabled:opacity-40">
                  Generate
                </button>
                <button disabled={!unlocked || d.status !== "approved"} className="h-8 inline-flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40">
                  <Download className="w-3 h-3" /> Download
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="ip-card">
          <div className="px-4 h-10 flex items-center justify-between border-b border-border">
            <div className="ip-kicker">Output Generation History</div>
            <div className="text-[10px] text-muted-foreground">Auto-Sync {unlocked ? "Enabled" : "Disabled"}</div>
          </div>
          <table className="w-full text-[12px] tabular-nums">
            <thead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left px-4 h-8">Timestamp</th>
                <th className="text-left px-4 h-8">User</th>
                <th className="text-left px-4 h-8">Deliverable</th>
                <th className="text-left px-4 h-8">Action</th>
                <th className="text-right px-4 h-8">Size</th>
              </tr>
            </thead>
            <tbody>
              {(unlocked ? [
                { ts: new Date().toISOString(), user: "Estimator", del: "Estimate Workbook", act: "Manual Generation", size: "4.2 MB" },
                { ts: new Date(Date.now() - 86400000).toISOString(), user: "System Task", del: "Fabrication Bundle", act: "Batch Processing", size: "18.5 MB" },
              ] : []).map((r, i) => (
                <tr key={i} style={{ height: 32 }} className="border-b border-border last:border-b-0">
                  <td className="px-4 font-mono text-[11px]">{new Date(r.ts).toLocaleString()}</td>
                  <td className="px-4">{r.user}</td>
                  <td className="px-4">{r.del}</td>
                  <td className="px-4 text-muted-foreground italic">{r.act}</td>
                  <td className="px-4 text-right">{r.size}</td>
                </tr>
              ))}
              {!unlocked && (
                <tr><td colSpan={5} className="px-4 h-12 text-center text-muted-foreground text-[11px] uppercase tracking-widest">No history — outputs locked</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {!unlocked && (
        <div className="px-4 py-2 border-t border-border bg-card text-[11px] uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-2">
          <Lock className="w-3 h-3" /> Final exports are gated by Estimator Confirmation
        </div>
      )}
    </div>
  );
}