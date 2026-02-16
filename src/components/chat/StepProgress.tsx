import React from "react";
import { Check, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const STEPS = [
  { num: 1, label: "OCR & Scope Detection", statusLabel: "Uploading" },
  { num: 2, label: "Rebar Type Selection", statusLabel: "Analyzing" },
  { num: 3, label: "Structural Elements", statusLabel: "Analyzing" },
  { num: 4, label: "Dimensions & Scale", statusLabel: "Analyzing" },
  { num: 5, label: "Quantities & Arrangement", statusLabel: "Processing" },
  { num: 5.5, label: "Length Optimization", statusLabel: "Processing" },
  { num: 6, label: "Weight Calculation", statusLabel: "Validating" },
  { num: 7, label: "Weight Summary", statusLabel: "Validating" },
  { num: 8, label: "Wire Mesh Estimation", statusLabel: "Complete" },
];

interface StepProgressProps {
  currentStep: number | null;
  mode: "smart" | "step-by-step" | null;
  processingPhase?: string | null;
}

const StepProgress: React.FC<StepProgressProps> = ({ currentStep, mode, processingPhase }) => {
  if (!mode) return null;

  const totalSteps = STEPS.length;
  const completedSteps = currentStep ? STEPS.filter((s) => s.num < currentStep).length : 0;
  const overallProgress = Math.round((completedSteps / totalSteps) * 100);

  return (
    <div className="px-3 py-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2 px-1">
        {mode === "smart" ? "⚡ Smart Mode" : "📋 Step-by-Step"}
      </p>

      {/* Overall Progress */}
      <div className="mb-3 px-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
          <span>Progress</span>
          <span className="font-semibold text-foreground">{overallProgress}%</span>
        </div>
        <Progress value={overallProgress} className="h-1" />
      </div>

      {/* Processing Phase */}
      {processingPhase && (
        <div className="flex items-center gap-2 px-2 py-1.5 mb-3 rounded-lg bg-primary/10 text-primary text-[11px] font-medium">
          <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
          <span className="truncate">{processingPhase}</span>
        </div>
      )}

      {/* Vertical Timeline */}
      <div className="relative pl-1">
        {STEPS.map((step, index) => {
          const isCompleted = currentStep !== null && step.num < currentStep;
          const isActive = currentStep !== null && step.num === currentStep;
          const isLast = index === STEPS.length - 1;

          return (
            <div key={step.num} className="relative flex items-start gap-3 group">
              {/* Vertical line */}
              {!isLast && (
                <div
                  className={`absolute left-[9px] top-[20px] w-[2px] h-[calc(100%)] transition-colors duration-300 ${
                    isCompleted ? "bg-primary" : "bg-border"
                  }`}
                  style={{ borderStyle: isCompleted ? "solid" : undefined }}
                />
              )}

              {/* Circle */}
              <div className="relative z-10 flex-shrink-0">
                {isCompleted ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </div>
                ) : isActive ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-primary bg-background timeline-pulse">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  </div>
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-border bg-background">
                    <div className="h-1.5 w-1.5 rounded-full bg-border" />
                  </div>
                )}
              </div>

              {/* Label */}
              <div className={`pb-4 pt-0.5 min-w-0 ${isActive ? "pb-5" : ""}`}>
                <span
                  className={`text-xs leading-tight transition-colors ${
                    isActive
                      ? "text-primary font-semibold"
                      : isCompleted
                      ? "text-muted-foreground"
                      : "text-muted-foreground/50"
                  }`}
                >
                  {step.label}
                </span>
                {isActive && (
                  <span className="ml-2 text-[9px] font-semibold text-primary/70 uppercase tracking-wider">
                    {step.statusLabel}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StepProgress;
