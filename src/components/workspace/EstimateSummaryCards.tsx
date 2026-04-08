import { DollarSign, CheckCircle2, AlertTriangle, XCircle, FileCheck, Pencil } from "lucide-react";

interface EstimateSummaryCardsProps {
  trustedTotal: number;
  pendingTotal: number;
  approvedCount: number;
  needsReviewCount: number;
  blockedCount: number;
  pricingAllowed: boolean;
  drawingGenerationAllowed: boolean;
  currency?: string;
}

function fmt(val: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(val);
}

export default function EstimateSummaryCards({
  trustedTotal, pendingTotal, approvedCount, needsReviewCount, blockedCount,
  pricingAllowed, drawingGenerationAllowed, currency = "CAD",
}: EstimateSummaryCardsProps) {
  const cards = [
    { label: "Trusted Total", value: fmt(trustedTotal, currency), icon: DollarSign, color: "text-[hsl(var(--status-approved))]", bg: "bg-[hsl(var(--status-approved)/.06)]" },
    { label: "Pending Total", value: fmt(pendingTotal, currency), icon: DollarSign, color: "text-[hsl(var(--status-review))]", bg: "bg-[hsl(var(--status-review)/.06)]" },
    { label: "Approved", value: String(approvedCount), icon: CheckCircle2, color: "text-[hsl(var(--status-approved))]", bg: "bg-[hsl(var(--status-approved)/.06)]" },
    { label: "Needs Review", value: String(needsReviewCount), icon: AlertTriangle, color: "text-[hsl(var(--status-review))]", bg: "bg-[hsl(var(--status-review)/.06)]" },
    { label: "Blocked", value: String(blockedCount), icon: XCircle, color: "text-[hsl(var(--status-blocked))]", bg: "bg-[hsl(var(--status-blocked)/.06)]" },
    { label: "Pricing", value: pricingAllowed ? "Allowed" : "Locked", icon: FileCheck, color: pricingAllowed ? "text-[hsl(var(--status-approved))]" : "text-muted-foreground", bg: "bg-muted/50" },
    { label: "Drawings", value: drawingGenerationAllowed ? "Allowed" : "Locked", icon: Pencil, color: drawingGenerationAllowed ? "text-[hsl(var(--status-approved))]" : "text-muted-foreground", bg: "bg-muted/50" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {cards.map((c) => (
        <div key={c.label} className={`${c.bg} rounded-lg border border-border px-3 py-2.5`}>
          <div className="flex items-center gap-1.5 mb-1">
            <c.icon className={`h-3.5 w-3.5 ${c.color}`} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{c.label}</span>
          </div>
          <p className={`text-base font-bold ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}
