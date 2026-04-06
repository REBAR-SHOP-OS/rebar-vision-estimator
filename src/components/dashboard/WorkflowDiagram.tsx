import React from "react";
import { Upload, ScanSearch, Calculator, FileSpreadsheet, CheckCircle2, ArrowDown } from "lucide-react";

interface WorkflowNode {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: "idle" | "active" | "done";
}

interface WorkflowDiagramProps {
  currentStep: number | null;
  processingPhase: string | null;
}

const WorkflowDiagram: React.FC<WorkflowDiagramProps> = ({ currentStep, processingPhase }) => {
  const nodes: WorkflowNode[] = [
    { id: "upload", label: "Upload", icon: <Upload className="h-3.5 w-3.5" />, status: getStatus(0) },
    { id: "scope", label: "Scope Detection", icon: <ScanSearch className="h-3.5 w-3.5" />, status: getStatus(1) },
    { id: "takeoff", label: "Takeoff", icon: <Calculator className="h-3.5 w-3.5" />, status: getStatus(2) },
    { id: "results", label: "Results", icon: <FileSpreadsheet className="h-3.5 w-3.5" />, status: getStatus(3) },
    { id: "complete", label: "Complete", icon: <CheckCircle2 className="h-3.5 w-3.5" />, status: getStatus(4) },
  ];

  function getStatus(step: number): "idle" | "active" | "done" {
    if (currentStep === null) return "idle";
    if (step < currentStep) return "done";
    if (step === currentStep) return "active";
    return "idle";
  }

  return (
    <div className="px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        Workflow
      </p>
      <div className="flex flex-col items-center gap-0">
        {nodes.map((node, i) => (
          <React.Fragment key={node.id}>
            <div
              className={`flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                node.status === "active"
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : node.status === "done"
                  ? "bg-primary/5 text-primary/70 border border-primary/10"
                  : "text-muted-foreground border border-transparent"
              }`}
            >
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full flex-shrink-0 ${
                  node.status === "active"
                    ? "bg-primary text-primary-foreground"
                    : node.status === "done"
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {node.icon}
              </div>
              <span className="truncate">{node.label}</span>
              {node.status === "active" && processingPhase && (
                <span className="ml-auto text-[9px] text-primary/70 truncate max-w-[60px]">
                  {processingPhase}
                </span>
              )}
              {node.status === "done" && (
                <CheckCircle2 className="ml-auto h-3 w-3 text-primary/50 flex-shrink-0" />
              )}
            </div>
            {i < nodes.length - 1 && (
              <div className="flex items-center justify-center h-3">
                <ArrowDown
                  className={`h-3 w-3 ${
                    node.status === "done" ? "text-primary/30" : "text-muted-foreground/20"
                  }`}
                />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default WorkflowDiagram;
