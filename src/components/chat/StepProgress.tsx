import React from "react";
import { Check, Circle, Loader2 } from "lucide-react";

const STEPS = [
  { num: 1, label: "OCR & Scope Detection" },
  { num: 2, label: "Rebar Type Selection" },
  { num: 3, label: "Structural Elements" },
  { num: 4, label: "Dimensions & Scale" },
  { num: 5, label: "Quantities & Arrangement" },
  { num: 5.5, label: "Length Optimization" },
  { num: 6, label: "Weight Calculation" },
  { num: 7, label: "Weight Summary" },
  { num: 8, label: "Wire Mesh Estimation" },
];

interface StepProgressProps {
  currentStep: number | null;
  mode: "smart" | "step-by-step" | null;
}

const StepProgress: React.FC<StepProgressProps> = ({ currentStep, mode }) => {
  if (!mode) return null;

  return (
    <div className="px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 px-1">
        {mode === "smart" ? "⚡ Smart Mode" : "📋 Step-by-Step"}
      </p>
      <div className="space-y-0.5">
        {STEPS.map((step) => {
          const isCompleted = currentStep !== null && step.num < currentStep;
          const isActive = currentStep !== null && step.num === currentStep;
          const isPending = currentStep === null || step.num > currentStep;

          return (
            <div
              key={step.num}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : isCompleted
                  ? "text-muted-foreground"
                  : "text-muted-foreground/50"
              }`}
            >
              <div className="flex-shrink-0">
                {isCompleted ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : isActive ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : (
                  <Circle className="h-3.5 w-3.5" />
                )}
              </div>
              <span className="truncate">
                {step.num % 1 === 0 ? `${step.num}` : `${step.num}`}. {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StepProgress;
