import { Fragment, useEffect, useMemo, useState } from "react";
import { StageHeader, Pill, EmptyState, GateBanner, type StageProps } from "./_shared";
import { ArrowLeft, ArrowRight, Wand2 } from "lucide-react";
import { loadWorkflowQaIssues, type WorkflowQaIssue } from "../takeoff-data";

export default function QAStage({ projectId, goToStage }: StageProps) {
  const [issues, setIssues] = useState<WorkflowQaIssue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await loadWorkflowQaIssues(projectId);
      if (cancelled) return;
      setIssues(data);
      setSelectedId((current) => data.find((issue) => issue.id === current)?.id || data[0]?.id || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const sel = issues.find((i) => i.id === selectedId);
  const grouped = useMemo(() => {
    const crit = issues.filter((i) => ["critical", "error"].includes(i.severity?.toLowerCase()));
    const warn = issues.filter((i) => i.severity?.toLowerCase() === "warning");
    const rest = issues.filter((i) => !["critical", "error", "warning"].includes(i.severity?.toLowerCase()));
    return [
      { key: "critical", label: `Critical Blockers (${crit.length})`, tone: "blocked" as const, items: crit },
      { key: "warn", label: `Review Warnings (${warn.length})`, tone: "inferred" as const, items: warn },
      { key: "rest", label: `Revision Conflicts (${rest.length})`, tone: "direct" as const, items: rest },
    ];
  }, [issues]);
  const critCount = grouped[0].items.length;

  return (
    <div className="flex flex-col h-full">
      {critCount > 0 && (
        <div className="px-4 pt-3">
          <GateBanner
            tone="blocked"
            title="Approval Gate Blocked"
            message={`${critCount} Critical Blocker${critCount === 1 ? "" : "s"} remaining. Export functionality is currently disabled.`}
            actions={
              <div className="flex gap-2">
                <button className="px-3 h-8 text-[11px] font-semibold uppercase tracking-[0.12em] bg-[hsl(var(--status-blocked))] text-white hover:opacity-90">
                  Resolve All Blockers
                </button>
                <button className="px-3 h-8 text-[11px] font-semibold uppercase tracking-[0.12em] border border-[hsl(var(--status-blocked))] text-[hsl(0_90%_88%)] hover:bg-[hsl(var(--status-blocked))]/20">
                  Request Override
                </button>
              </div>
            }
          />
        </div>
      )}
      <div className="grid grid-cols-12 flex-1 min-h-0">
        <div className="col-span-8 border-r border-border flex flex-col min-h-0">
          <StageHeader
            kicker="Stage 04"
            title="QA Issue Management"
            subtitle="Decides whether items return to takeoff or advance to confirmation."
            right={
              <button
                disabled={loading || critCount > 0}
                onClick={() => goToStage?.("confirm")}
                className="inline-flex h-8 items-center justify-center gap-1.5 border border-primary/50 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:opacity-50"
              >
                Advance <ArrowRight className="w-3 h-3" />
              </button>
            }
          />
          <div className="flex-1 overflow-auto">
            {loading ? <EmptyState title="Loading QA issues..." /> :
              issues.length === 0 ? <EmptyState title="No QA issues" hint="No active blockers or warnings found. Advance to confirmation when takeoff looks correct." /> : (
                <table className="w-full text-[12px] tabular-nums">
                  <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left px-3 h-8 w-24">Type</th>
                      <th className="text-left px-3 h-8">Issue / Reason</th>
                      <th className="text-left px-3 h-8 w-32">Element ID</th>
                      <th className="text-left px-3 h-8 w-24">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((g) => (
                      g.items.length > 0 && (
                        <Fragment key={g.key}>
                          <tr className="bg-muted/20 border-t border-border">
                            <td colSpan={4} className="px-3 h-7 text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">{g.label}</td>
                          </tr>
                          {g.items.map((issue) => (
                            <tr key={issue.id} onClick={() => setSelectedId(issue.id)}
                              style={{ height: 36 }}
                              className={`border-t border-border cursor-pointer ${selectedId === issue.id ? "bg-primary/10" : "hover:bg-accent/40"}`}>
                              <td className="px-3"><Pill tone={g.tone} solid>{g.key === "critical" ? "BLOCK" : g.key === "warn" ? "WARN" : "REV"}</Pill></td>
                              <td className="px-3">
                                <div className="font-medium truncate">{issue.title}</div>
                                {issue.description && <div className="text-[11px] text-muted-foreground truncate">{issue.description}</div>}
                              </td>
                              <td className="px-3 font-mono text-[11px] text-muted-foreground">{issue.sheet_id?.slice(0, 12) || "-"}</td>
                              <td className="px-3 text-muted-foreground">{issue.status}</td>
                            </tr>
                          ))}
                        </Fragment>
                      )
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
        <div className="col-span-4 flex flex-col min-h-0" style={{ background: "hsl(var(--card))" }}>
          <StageHeader kicker="Linked Source Review" title={sel ? sel.title : "Select an issue"} />
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {!sel ? <EmptyState title="No issue selected" /> : (
              <>
                <div className="aspect-video border border-border bg-background grid place-items-center text-muted-foreground relative blueprint-bg">
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="w-20 h-20 rounded-full border-2 border-[hsl(var(--status-blocked))]/60 grid place-items-center">
                      <div className="w-2 h-2 bg-[hsl(var(--status-blocked))] rounded-full" />
                    </div>
                  </div>
                  <span className="absolute top-2 left-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground bg-background/80 px-1.5 py-0.5">
                    Drawing: {sel.sheet_id?.slice(0, 8) || "-"}
                  </span>
                </div>
                <div className="ip-card p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="ip-kicker">Issue Focus</span>
                    <Pill tone={["critical", "error"].includes(sel.severity?.toLowerCase()) ? "blocked" : "inferred"} solid>
                      {sel.severity?.toUpperCase() || "-"}
                    </Pill>
                  </div>
                  <div className="text-[12px] font-mono mb-1.5">{sel.id.slice(0, 16).toUpperCase()}</div>
                  <div className="text-[12px] text-muted-foreground leading-relaxed">{sel.description || "No description provided."}</div>
                </div>
                <div className="ip-card p-3">
                  <div className="ip-kicker mb-1.5 flex items-center gap-1.5"><Wand2 className="w-3 h-3" /> Recommended Fix</div>
                  <div className="text-[12px] italic text-muted-foreground">Review element source and apply standard correction per project spec.</div>
                </div>
                <button className="w-full h-9 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.14em] hover:opacity-90">
                  <Wand2 className="w-3.5 h-3.5" /> Apply Recommended Fix
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => goToStage?.("takeoff")}
                    className="h-8 inline-flex items-center justify-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] border border-[hsl(var(--status-inferred))]/50 text-[hsl(var(--status-inferred))] hover:bg-[hsl(var(--status-inferred))]/10"
                  >
                    <ArrowLeft className="w-3 h-3" /> Return to Takeoff
                  </button>
                  <button
                    disabled={critCount > 0}
                    onClick={() => goToStage?.("confirm")}
                    className="h-8 inline-flex items-center justify-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] border border-primary/50 text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:opacity-50"
                  >
                    Advance <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="ip-card p-3 text-[11px]">
                  <div className="ip-kicker mb-2">Activity Log</div>
                  <div className="space-y-2">
                    <div className="flex gap-2"><span className="w-1.5 h-1.5 mt-1.5 bg-primary inline-block" /><div><div className="font-medium">Conflict flagged by system</div><div className="text-muted-foreground text-[10px] font-mono">{new Date().toLocaleString()}</div></div></div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
