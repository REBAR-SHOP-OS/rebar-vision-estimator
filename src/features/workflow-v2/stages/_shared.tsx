import type { WorkflowStateFull } from "../useWorkflowState";

export interface StageProps {
  projectId: string;
  state: WorkflowStateFull;
}

export function StageHeader({ kicker, title, subtitle, right }: { kicker: string; title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{kicker}</div>
        <div className="text-base font-semibold">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function Pill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "ok" | "warn" | "bad" | "info" }) {
  const cls = {
    default: "border-border text-muted-foreground",
    ok: "border-primary/40 text-primary bg-primary/5",
    warn: "border-yellow-500/40 text-yellow-600 dark:text-yellow-400 bg-yellow-500/5",
    bad: "border-destructive/40 text-destructive bg-destructive/5",
    info: "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/5",
  }[tone];
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-mono border ${cls}`}>{children}</span>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="text-sm font-mono uppercase tracking-widest text-muted-foreground">{title}</div>
      {hint && <div className="text-xs text-muted-foreground/70 mt-2 max-w-sm">{hint}</div>}
    </div>
  );
}