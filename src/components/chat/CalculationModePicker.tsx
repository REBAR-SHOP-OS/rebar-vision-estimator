import React from "react";
import { Zap, ListChecks } from "lucide-react";

interface CalculationModePickerProps {
  onSelect: (mode: "smart" | "step-by-step") => void;
  disabled?: boolean;
}

const CalculationModePicker: React.FC<CalculationModePickerProps> = ({ onSelect, disabled }) => {
  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-sm font-medium text-foreground">
        How would you like to proceed with the estimation?
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => onSelect("smart")}
          disabled={disabled}
          className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Smart Calculation</h4>
            <p className="text-xs text-muted-foreground mt-1">
              AI performs all 8 steps automatically and delivers the final weight instantly. Shows full calculation details.
            </p>
          </div>
        </button>

        <button
          onClick={() => onSelect("step-by-step")}
          disabled={disabled}
          className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Step-by-Step</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Go through each step interactively. Confirm, adjust, and control every stage of the estimation.
            </p>
          </div>
        </button>
      </div>
    </div>
  );
};

export default CalculationModePicker;
