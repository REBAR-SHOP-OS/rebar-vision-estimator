import { AlertTriangle, Lock, CheckCircle2 } from "lucide-react";

interface StatusBannerProps {
  blockedCount: number;
  needsReviewCount: number;
  pricingAllowed: boolean;
  drawingGenerationAllowed: boolean;
}

export default function StatusBanner({
  blockedCount,
  needsReviewCount,
  pricingAllowed,
  drawingGenerationAllowed,
}: StatusBannerProps) {
  if (blockedCount === 0 && needsReviewCount === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--status-approved)/.08)] border border-[hsl(var(--status-approved)/.2)] rounded-lg text-sm">
        <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-approved))]" />
        <span className="font-medium text-[hsl(var(--status-approved))]">All items approved — ready for pricing</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-[hsl(var(--status-review)/.08)] border border-[hsl(var(--status-review)/.2)] rounded-lg text-sm">
      {blockedCount > 0 && (
        <span className="flex items-center gap-1.5 text-[hsl(var(--status-blocked))] font-medium">
          <AlertTriangle className="h-4 w-4" />
          {blockedCount} blocked
        </span>
      )}
      {needsReviewCount > 0 && (
        <span className="flex items-center gap-1.5 text-[hsl(var(--status-review))] font-medium">
          <AlertTriangle className="h-4 w-4" />
          {needsReviewCount} needs review
        </span>
      )}
      {!drawingGenerationAllowed && (
        <span className="flex items-center gap-1.5 text-muted-foreground ml-auto">
          <Lock className="h-3.5 w-3.5" />
          Drawing Generation Locked
        </span>
      )}
      {!pricingAllowed && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          Pricing Locked
        </span>
      )}
    </div>
  );
}
