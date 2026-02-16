import React from "react";
import { Zap, ListChecks, Clock, Check } from "lucide-react";

interface CalculationModePickerProps {
  onSelect: (mode: "smart" | "step-by-step") => void;
  disabled?: boolean;
}

const CalculationModePicker: React.FC<CalculationModePickerProps> = ({ onSelect, disabled }) => {
  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-bold">3</div>
        <div>
          <p className="text-sm font-semibold text-foreground">Choose Calculation Mode</p>
          <p className="text-xs text-muted-foreground">Select how you want the estimation to run</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Smart Mode */}
        <button
          onClick={() => onSelect("smart")}
          disabled={disabled}
          className="group relative flex flex-col items-start gap-3 rounded-xl border-2 border-border bg-card p-5 text-left transition-all hover:border-primary hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-3 w-full">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground">~2 min</span>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-bold text-foreground mb-1.5">Smart Calculation</h4>
            <ul className="space-y-1">
              <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-primary flex-shrink-0" />
                All 8 steps run automatically
              </li>
              <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-primary flex-shrink-0" />
                Instant weight calculation
              </li>
              <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-primary flex-shrink-0" />
                Full details included
              </li>
            </ul>
          </div>
        </button>

        {/* Step-by-Step Mode */}
        <button
          onClick={() => onSelect("step-by-step")}
          disabled={disabled}
          className="group relative flex flex-col items-start gap-3 rounded-xl border-2 border-border bg-card p-5 text-left transition-all hover:border-primary hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-3 w-full">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <ListChecks className="h-5 w-5" />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground">~10 min</span>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-bold text-foreground mb-1.5">Step-by-Step</h4>
            <ul className="space-y-1">
              <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-primary flex-shrink-0" />
                Interactive review per step
              </li>
              <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-primary flex-shrink-0" />
                Confirm & adjust each stage
              </li>
              <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-primary flex-shrink-0" />
                Maximum control & accuracy
              </li>
            </ul>
          </div>
        </button>
      </div>
    </div>
  );
};

export default CalculationModePicker;
