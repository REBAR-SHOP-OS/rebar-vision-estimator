import { useState, useMemo } from "react";
import { STAGES, type StageKey } from "./types";
import { Lock, CheckCircle2, Circle, AlertTriangle, FolderOpen, Layers, Ruler, ShieldCheck, Stamp, FileSpreadsheet, Search, Bell, HelpCircle } from "lucide-react";
import FilesStage from "./stages/FilesStage";
import ScopeStage from "./stages/ScopeStage";
import TakeoffStage from "./stages/TakeoffStage";
import QAStage from "./stages/QAStage";
import ConfirmStage from "./stages/ConfirmStage";
import OutputsStage from "./stages/OutputsStage";
import { useWorkflowState } from "./useWorkflowState";

interface Props {
  projectId: string;
  project: {
    name?: string;
    client_name?: string;
    customer_name?: string;
    project_name?: string;
    project_type?: string;
    canonicalProject?: {
      projectName?: string;
      customerName?: string | null;
    } | null;
  };
}

const STAGE_ICONS: Record<StageKey, React.ComponentType<{ className?: string }>> = {
  files: FolderOpen,
  scope: Layers,
  takeoff: Ruler,
  qa: ShieldCheck,
  confirm: Stamp,
  outputs: FileSpreadsheet,
};

export default function WorkflowShell({ projectId, project }: Props) {
  const [active, setActive] = useState<StageKey>("files");
  const state = useWorkflowState(projectId);

  const displayProjectName = project.project_name || project.canonicalProject?.projectName || project.name || "Untitled Project";
  const displayCustomerName = project.customer_name || project.canonicalProject?.customerName || project.client_name;

  const status = useMemo(() => ({
    files: state.fileCount > 0 ? "complete" : "pending",
    scope: state.scopeAccepted > 0 ? "complete" : state.fileCount > 0 ? "active" : "locked",
    takeoff: state.takeoffRows > 0 ? "complete" : state.scopeAccepted > 0 ? "active" : "locked",
    qa: state.qaCriticalOpen > 0 ? "blocked" : state.takeoffRows > 0 ? "active" : "locked",
    confirm: state.estimatorConfirmed ? "complete" : (state.qaCriticalOpen === 0 && state.takeoffRows > 0) ? "active" : "locked",
    outputs: state.estimatorConfirmed ? "active" : "locked",
  }) as Record<StageKey, "complete" | "active" | "locked" | "blocked" | "pending">, [state]);

  const StageBody = () => {
    const props = { projectId, state };
    switch (active) {
      case "files": return <FilesStage {...props} />;
      case "scope": return <ScopeStage {...props} />;
      case "takeoff": return <TakeoffStage {...props} />;
      case "qa": return <QAStage {...props} />;
      case "confirm": return <ConfirmStage {...props} />;
      case "outputs": return <OutputsStage {...props} />;
    }
  };

  const kpis = [
    { label: "Files", value: state.fileCount, tone: "default" as const },
    { label: "Scope Approved", value: `${state.scopeAccepted}/${state.scopeCandidates}`, tone: state.scopeAccepted > 0 ? "ok" : "default" as const },
    { label: "Takeoff Rows", value: state.takeoffRows, tone: "default" as const },
    { label: "QA Critical", value: state.qaCriticalOpen, tone: state.qaCriticalOpen > 0 ? "bad" : "ok" as const },
    { label: "QA Open", value: state.qaOpen, tone: state.qaOpen > 0 ? "warn" : "ok" as const },
    { label: "Outputs", value: state.estimatorConfirmed ? "READY" : "LOCKED", tone: state.estimatorConfirmed ? "ok" : "default" as const },
  ];

  return (
    <div className="workflow-v2 flex h-full text-foreground" style={{ background: "hsl(var(--background))" }}>
      {/* Left Rail */}
      <aside className="w-[200px] shrink-0 border-r border-border flex flex-col" style={{ background: "hsl(var(--card))" }}>
        <div className="px-4 py-4 border-b border-border">
          <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground">RebarEstimate Pro</div>
          <div className="text-[9px] tracking-[0.22em] uppercase text-muted-foreground mt-0.5">Precision Estimating</div>
        </div>
        <nav className="flex-1 py-2">
          {STAGES.map((s) => {
            const Icon = STAGE_ICONS[s.key];
            const st = status[s.key];
            const isActive = active === s.key;
            const locked = st === "locked";
            return (
              <button
                key={s.key}
                disabled={locked}
                onClick={() => setActive(s.key)}
                className={[
                  "w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[12px] tracking-wide transition-colors border-l-2 relative",
                  isActive ? "border-l-primary bg-primary/10 text-primary" : "border-l-transparent text-foreground/80 hover:bg-accent/40",
                  locked ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{s.short}</span>
                {st === "blocked" && <AlertTriangle className="w-3 h-3 text-destructive" />}
                {st === "complete" && <CheckCircle2 className="w-3 h-3 text-primary/70" />}
                {locked && <Lock className="w-3 h-3" />}
              </button>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-border text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-[hsl(var(--status-supported))] inline-block" /> System Online</div>
          <div className="mt-1">v2.0 · Industrial</div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col overflow-x-auto">
        {/* Top header */}
        <header className="flex min-w-[1100px] items-center justify-between px-5 py-2.5 border-b border-border" style={{ background: "hsl(var(--card))" }}>
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="ip-kicker">Project</span>
            <span className="text-[14px] font-semibold tracking-tight truncate">{displayProjectName}</span>
            {displayCustomerName && <span className="text-[11px] text-muted-foreground truncate">· {displayCustomerName}</span>}
            {project.project_type && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">· {project.project_type}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 px-2.5 h-7 border border-border bg-background w-[260px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input placeholder="Search project data…" className="bg-transparent outline-none text-[12px] flex-1 placeholder:text-muted-foreground/70" />
            </div>
            <button className="h-7 w-7 grid place-items-center border border-border hover:bg-accent/40"><Bell className="w-3.5 h-3.5" /></button>
            <button className="h-7 w-7 grid place-items-center border border-border hover:bg-accent/40"><HelpCircle className="w-3.5 h-3.5" /></button>
            <span className="ml-1 px-2 py-1 text-[9px] font-mono uppercase tracking-widest border border-border text-muted-foreground">PROJ · {projectId.slice(0, 8)}</span>
          </div>
        </header>

        {/* KPI Strip */}
        <div className="grid min-w-[1100px] grid-cols-6 border-b border-border" style={{ background: "hsl(var(--background))" }}>
          {kpis.map((k) => (
            <div key={k.label} className="px-4 py-2.5 border-r border-border last:border-r-0">
              <div className="ip-kicker truncate">{k.label}</div>
              <div className={[
                "mt-0.5 text-[18px] font-semibold tabular-nums leading-tight",
                k.tone === "ok" ? "text-[hsl(var(--status-supported))]" :
                k.tone === "warn" ? "text-[hsl(var(--status-inferred))]" :
                k.tone === "bad" ? "text-[hsl(var(--status-blocked))]" : "text-foreground",
              ].join(" ")}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Stage rail (numbered steps) */}
        <div className="flex min-w-[1100px] items-stretch border-b border-border" style={{ background: "hsl(var(--card))" }}>
          {STAGES.map((s) => {
            const st = status[s.key];
            const isActive = active === s.key;
            const locked = st === "locked";
            const blocked = st === "blocked";
            const complete = st === "complete";
            return (
              <button
                key={s.key}
                disabled={locked}
                onClick={() => setActive(s.key)}
                className={[
                  "flex-1 flex items-center gap-2.5 px-3 py-2 border-r border-border text-left transition-colors",
                  isActive ? "bg-background" : "hover:bg-accent/30",
                  locked ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                  blocked ? "border-b-2 border-b-destructive" : isActive ? "border-b-2 border-b-primary" : "border-b-2 border-b-transparent",
                ].join(" ")}
              >
                <span className={[
                  "flex items-center justify-center w-7 h-7 text-[11px] font-bold border tabular-nums",
                  complete ? "bg-primary/10 border-primary text-primary" :
                  blocked ? "bg-destructive/10 border-destructive text-destructive" :
                  isActive ? "border-primary text-primary" : "border-border text-muted-foreground",
                ].join(" ")}>
                  {complete ? <CheckCircle2 className="w-3.5 h-3.5" /> : blocked ? <AlertTriangle className="w-3.5 h-3.5" /> : locked ? <Lock className="w-3 h-3" /> : `0${s.index}`}
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="ip-kicker truncate">Stage 0{s.index}</span>
                  <span className="text-[12px] font-medium truncate">{s.label}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto" style={{ background: "hsl(var(--background))" }}>
          <div className="h-full min-w-[1200px]">
            <StageBody />
          </div>
        </div>

        {/* Footer telemetry */}
        <footer className="flex min-w-[1100px] items-center justify-between px-5 py-1.5 border-t border-border text-[10px] uppercase tracking-[0.18em] text-muted-foreground" style={{ background: "hsl(var(--card))" }}>
          <div className="flex gap-5 tabular-nums">
            <span>SYNC <span className="text-[hsl(var(--status-supported))]">● ACTIVE</span></span>
            <span>OCR <span className="text-foreground">99.4%</span></span>
            <span>LATENCY <span className="text-foreground">1.2s</span></span>
            <span>QA <span className={state.qaCriticalOpen > 0 ? "text-[hsl(var(--status-blocked))]" : "text-foreground"}>{state.qaCriticalOpen} CRIT · {state.qaOpen} OPEN</span></span>
          </div>
          <div className="flex items-center gap-2">
            {state.estimatorConfirmed
              ? <span className="text-primary flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> Estimator Confirmed · Outputs Unlocked</span>
              : <span className="flex items-center gap-1.5"><Circle className="w-3 h-3" /> Awaiting Estimator Confirmation</span>}
          </div>
        </footer>
      </div>
    </div>
  );
}
