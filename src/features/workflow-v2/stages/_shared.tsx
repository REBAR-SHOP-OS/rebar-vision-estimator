import type { WorkflowStateFull } from "../useWorkflowState";
import type { StageKey } from "../types";

export interface StageProps {
  projectId: string;
  state: WorkflowStateFull;
  goToStage?: (stage: StageKey) => void;
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

export function Pill({ children, tone = "default", solid = false }: { children: React.ReactNode; tone?: "default" | "ok" | "warn" | "bad" | "info" | "direct" | "inferred" | "supported" | "blocked"; solid?: boolean }) {
  const map: Record<string, string> = {
    default: "border-border text-muted-foreground bg-transparent",
    ok: "border-[hsl(var(--status-supported))]/50 text-[hsl(var(--status-supported))] bg-[hsl(var(--status-supported))]/5",
    supported: "border-[hsl(var(--status-supported))]/50 text-[hsl(var(--status-supported))] bg-[hsl(var(--status-supported))]/5",
    warn: "border-[hsl(var(--status-inferred))]/50 text-[hsl(var(--status-inferred))] bg-[hsl(var(--status-inferred))]/5",
    inferred: "border-[hsl(var(--status-inferred))]/50 text-[hsl(var(--status-inferred))] bg-[hsl(var(--status-inferred))]/5",
    bad: "border-[hsl(var(--status-blocked))]/50 text-[hsl(var(--status-blocked))] bg-[hsl(var(--status-blocked))]/8",
    blocked: "border-[hsl(var(--status-blocked))]/50 text-[hsl(var(--status-blocked))] bg-[hsl(var(--status-blocked))]/8",
    info: "border-[hsl(var(--status-direct))]/50 text-[hsl(var(--status-direct))] bg-[hsl(var(--status-direct))]/5",
    direct: "border-[hsl(var(--status-direct))]/50 text-[hsl(var(--status-direct))] bg-[hsl(var(--status-direct))]/5",
  };
  const solidMap: Record<string, string> = {
    direct: "bg-[hsl(var(--status-direct))] text-white border-[hsl(var(--status-direct))]",
    inferred: "bg-[hsl(var(--status-inferred))] text-black border-[hsl(var(--status-inferred))]",
    supported: "bg-[hsl(var(--status-supported))] text-black border-[hsl(var(--status-supported))]",
    blocked: "bg-[hsl(var(--status-blocked))] text-white border-[hsl(var(--status-blocked))]",
    ok: "bg-[hsl(var(--status-supported))] text-black border-[hsl(var(--status-supported))]",
    warn: "bg-[hsl(var(--status-inferred))] text-black border-[hsl(var(--status-inferred))]",
    bad: "bg-[hsl(var(--status-blocked))] text-white border-[hsl(var(--status-blocked))]",
    info: "bg-[hsl(var(--status-direct))] text-white border-[hsl(var(--status-direct))]",
    default: "bg-muted text-foreground border-border",
  };
  const cls = solid ? solidMap[tone] : map[tone];
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold border ${cls}`} style={{ borderRadius: 2 }}>{children}</span>;
}

export function GateBanner({ tone = "blocked", title, message, actions }: { tone?: "blocked" | "warn"; title: string; message?: string; actions?: React.ReactNode }) {
  const ring = tone === "blocked" ? "border-[hsl(var(--status-blocked))]/60 bg-[hsl(var(--status-blocked))]/10 text-[hsl(0_90%_88%)]" : "border-[hsl(var(--status-inferred))]/60 bg-[hsl(var(--status-inferred))]/10";
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 border ${ring}`}>
      <AlertTriangleSm />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold tracking-wide">{title}</div>
        {message && <div className="text-[11px] opacity-80 mt-0.5">{message}</div>}
      </div>
      {actions}
    </div>
  );
}

function AlertTriangleSm() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M12 3 L22 21 L2 21 Z" /><line x1="12" y1="10" x2="12" y2="15" /><circle cx="12" cy="18" r="0.5" />
    </svg>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="text-sm font-mono uppercase tracking-widest text-muted-foreground">{title}</div>
      {hint && <div className="text-xs text-muted-foreground/70 mt-2 max-w-sm">{hint}</div>}
    </div>
  );
}

export function CalibrationGate({ state, goToStage, stageLabel }: { state: StageProps["state"]; goToStage?: StageProps["goToStage"]; stageLabel: string }) {
  if (state.local.calibrationConfirmed) return null;
  return (
    <div className="p-4">
      <GateBanner
        tone="blocked"
        title={`${stageLabel} blocked: scale calibration required`}
        message="Confirm sheet scales in Stage 03 — Scale Calibration before quantities can be computed from drawings."
        actions={
          goToStage ? (
            <button
              onClick={() => goToStage("calibration")}
              className="text-[11px] uppercase tracking-wider font-semibold border border-current px-2 py-1 hover:bg-current/10"
              style={{ borderRadius: 2 }}
            >
              Open Calibration →
            </button>
          ) : null
        }
      />
    </div>
  );
}
