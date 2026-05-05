import { useState, useMemo } from "react";
import { STAGES, type StageKey } from "./types";
import { Lock, CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import FilesStage from "./stages/FilesStage";
import ScopeStage from "./stages/ScopeStage";
import TakeoffStage from "./stages/TakeoffStage";
import QAStage from "./stages/QAStage";
import ConfirmStage from "./stages/ConfirmStage";
import OutputsStage from "./stages/OutputsStage";
import { useWorkflowState } from "./useWorkflowState";

interface Props {
  projectId: string;
  project: { name?: string; client_name?: string; project_type?: string };
}

export default function WorkflowShell({ projectId, project }: Props) {
  const [active, setActive] = useState<StageKey>("files");
  const state = useWorkflowState(projectId);

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

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/40">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Rebar Vision Estimator V2</span>
          <span className="text-sm font-mono font-semibold">{project.name || "Project"}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          {project.client_name && <span>Client · <span className="text-foreground/80">{project.client_name}</span></span>}
          {project.project_type && <span>Type · <span className="text-foreground/80">{project.project_type}</span></span>}
          <span className="px-2 py-0.5 border border-border rounded-none">PROJ ID · {projectId.slice(0, 8)}</span>
        </div>
      </div>

      {/* Stage Rail */}
      <div className="flex items-stretch border-b border-border bg-card">
        {STAGES.map((s, idx) => {
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
                "group flex-1 flex items-center gap-2 px-3 py-2 border-r border-border text-left transition-colors",
                isActive ? "bg-background" : "bg-card hover:bg-muted/40",
                locked ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                blocked ? "border-b-2 border-b-destructive" : isActive ? "border-b-2 border-b-primary" : "border-b-2 border-b-transparent",
              ].join(" ")}
            >
              <span className={[
                "flex items-center justify-center w-6 h-6 text-[10px] font-mono border",
                complete ? "bg-primary/10 border-primary text-primary" :
                blocked ? "bg-destructive/10 border-destructive text-destructive" :
                isActive ? "border-primary text-primary" : "border-border text-muted-foreground",
              ].join(" ")}>
                {complete ? <CheckCircle2 className="w-3 h-3" /> : blocked ? <AlertTriangle className="w-3 h-3" /> : locked ? <Lock className="w-3 h-3" /> : s.index}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Stage {s.index}</span>
                <span className="text-xs font-medium truncate">{s.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <StageBody />
      </div>

      {/* Footer status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-muted/40 text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
        <div className="flex gap-4">
          <span>Files <span className="text-foreground">{state.fileCount}</span></span>
          <span>Scope <span className="text-foreground">{state.scopeAccepted}/{state.scopeCandidates}</span></span>
          <span>Takeoff <span className="text-foreground">{state.takeoffRows}</span></span>
          <span>QA <span className={state.qaCriticalOpen > 0 ? "text-destructive" : "text-foreground"}>{state.qaCriticalOpen} crit · {state.qaOpen} open</span></span>
        </div>
        <div className="flex items-center gap-2">
          {state.estimatorConfirmed
            ? <span className="text-primary flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Estimator Confirmed · Outputs Unlocked</span>
            : <span className="flex items-center gap-1"><Circle className="w-3 h-3" /> Awaiting Estimator Confirmation</span>}
        </div>
      </div>
    </div>
  );
}