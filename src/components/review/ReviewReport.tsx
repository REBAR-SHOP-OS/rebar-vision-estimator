import React from "react";
import { Badge } from "@/components/ui/badge";

interface BarItem {
  element_type?: string;
  element_id?: string;
  bar_mark?: string;
  size?: string;
  shape_code?: string;
  qty?: number;
  length_ft?: number;
  weight_lbs?: number;
}

interface ReviewData {
  bar_list?: BarItem[];
  size_breakdown?: Record<string, number>;
  scope?: {
    projectName?: string;
    clientName?: string;
    projectType?: string;
    coatingType?: string;
    scopeItems?: string[];
    deviations?: string;
  };
  methodology?: string;
  total_weight_lbs?: number;
  total_weight_tons?: number | string;
  elements_count?: number;
  ready_count?: number;
  flagged_count?: number;
}

interface ReviewReportProps {
  reviewData: ReviewData;
}

// Weight tables removed — use canonical source in @/lib/rebar-weights.ts if needed

const ReviewReport: React.FC<ReviewReportProps> = ({ reviewData }) => {
  if (!reviewData || Object.keys(reviewData).length === 0) return null;

  const barList = reviewData.bar_list || [];
  const sizeBreakdown = reviewData.size_breakdown || {};
  const scope = reviewData.scope || {};
  const methodology = reviewData.methodology || "";

  // Group bar list by element type
  const grouped: Record<string, BarItem[]> = {};
  for (const b of barList) {
    const t = b.element_type || "OTHER";
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(b);
  }

  const sortedSizes = Object.entries(sizeBreakdown).sort(
    (a, b) => parseInt(String(a[0]).replace("#", "")) - parseInt(String(b[0]).replace("#", ""))
  );
  const sizeTotal: number = Object.values(sizeBreakdown).reduce((a: number, b) => a + Number(b), 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground">
            {reviewData.total_weight_lbs?.toLocaleString() || "—"}
          </p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total lbs</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground">
            {reviewData.total_weight_tons || "—"}
          </p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total tons</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground">
            {reviewData.elements_count || "—"}
          </p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Elements</p>
        </div>
      </div>

      {/* Element status */}
      <div className="flex gap-2">
        <Badge className="bg-primary/20 text-primary border-primary/30">
          {reviewData.ready_count || 0} Ready
        </Badge>
        <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">
          {reviewData.flagged_count || 0} Flagged
        </Badge>
      </div>

      {/* Scope */}
      {scope && scope.projectName && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-sm font-bold text-foreground">Scope Definition</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Project: </span><span className="font-medium">{scope.projectName}</span></div>
            <div><span className="text-muted-foreground">Client: </span><span className="font-medium">{scope.clientName || "—"}</span></div>
            <div><span className="text-muted-foreground">Type: </span><span className="font-medium">{scope.projectType || "—"}</span></div>
            <div><span className="text-muted-foreground">Coating: </span><span className="font-medium">{scope.coatingType || "Black Steel"}</span></div>
          </div>
          {scope.scopeItems?.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">Scope Items: </span>
              <span className="font-medium">{scope.scopeItems.join(", ")}</span>
            </div>
          )}
          {scope.deviations && (
            <div className="text-xs">
              <span className="text-muted-foreground">Deviations: </span>
              <span className="font-medium">{scope.deviations}</span>
            </div>
          )}
        </div>
      )}

      {/* Methodology */}
      {methodology && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-sm font-bold text-foreground">Methodology</h3>
          <div className="text-xs text-foreground whitespace-pre-line leading-relaxed">
            {methodology.replace(/^## .*\n/gm, "").replace(/^### /gm, "**").replace(/\*\*/g, "")}
          </div>
        </div>
      )}

      {/* Size Breakdown */}
      {sortedSizes.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-sm font-bold text-foreground">Size Breakdown</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1.5 text-muted-foreground font-medium">Size</th>
                <th className="text-right py-1.5 text-muted-foreground font-medium">Weight (lbs)</th>
                <th className="text-right py-1.5 text-muted-foreground font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {sortedSizes.map(([size, weight]) => (
                <tr key={size} className="border-b border-border/50">
                  <td className="py-1.5 font-medium">{size}</td>
                  <td className="py-1.5 text-right">{Number(weight).toLocaleString()}</td>
                  <td className="py-1.5 text-right text-muted-foreground">
                    {sizeTotal > 0 ? ((Number(weight) / Number(sizeTotal)) * 100).toFixed(1) : "0"}%
                  </td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-1.5">TOTAL</td>
                <td className="py-1.5 text-right">{sizeTotal.toLocaleString()}</td>
                <td className="py-1.5 text-right">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Bar List */}
      {barList.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-sm font-bold text-foreground">Bar List ({barList.length} items)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 text-muted-foreground font-medium">Element</th>
                  <th className="text-left py-1.5 text-muted-foreground font-medium">Mark</th>
                  <th className="text-left py-1.5 text-muted-foreground font-medium">Size</th>
                  <th className="text-left py-1.5 text-muted-foreground font-medium">Shape</th>
                  <th className="text-right py-1.5 text-muted-foreground font-medium">Qty</th>
                  <th className="text-right py-1.5 text-muted-foreground font-medium">Length</th>
                  <th className="text-right py-1.5 text-muted-foreground font-medium">Weight</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(grouped).map(([type, bars]) => {
                  const subtotal = bars.reduce((s, b) => s + (b.weight_lbs || 0), 0);
                  return (
                    <React.Fragment key={type}>
                      <tr>
                        <td colSpan={7} className="py-1.5 font-bold text-foreground bg-muted/50 px-2">
                          {type}
                        </td>
                      </tr>
                      {bars.map((b, i: number) => (
                        <tr key={`${type}-${i}`} className="border-b border-border/30">
                          <td className="py-1">{b.element_id}</td>
                          <td className="py-1">{b.bar_mark || "—"}</td>
                          <td className="py-1">{b.size}</td>
                          <td className="py-1">{b.shape_code || "—"}</td>
                          <td className="py-1 text-right">{b.qty}</td>
                          <td className="py-1 text-right">{b.length_ft}'</td>
                          <td className="py-1 text-right">{(b.weight_lbs || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                      <tr className="border-b border-border">
                        <td colSpan={6} className="py-1 text-right font-semibold text-muted-foreground">
                          {type} Subtotal
                        </td>
                        <td className="py-1 text-right font-semibold">{subtotal.toLocaleString()}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewReport;
