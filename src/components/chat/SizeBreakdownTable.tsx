import React from "react";

interface SizeBreakdownTableProps {
  sizeBreakdown: Record<string, number>;
  sizeBreakdownKg?: Record<string, number>;
}

const SizeBreakdownTable: React.FC<SizeBreakdownTableProps> = ({ sizeBreakdown, sizeBreakdownKg }) => {
  const entries = Object.entries(sizeBreakdown);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, w]) => sum + (w as number), 0);
  const hasKg = sizeBreakdownKg && Object.keys(sizeBreakdownKg).length > 0;
  const totalKg = hasKg ? Object.values(sizeBreakdownKg!).reduce((sum, w) => sum + w, 0) : total * 0.453592;

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wider">Weight by Rebar Size</p>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-secondary">
              <th className="text-left px-3 py-2 font-semibold text-secondary-foreground">Size</th>
              <th className="text-right px-3 py-2 font-semibold text-secondary-foreground">Weight (kg)</th>
              <th className="text-right px-3 py-2 font-semibold text-secondary-foreground">Weight (lbs)</th>
              <th className="text-right px-3 py-2 font-semibold text-secondary-foreground">%</th>
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([size, weight], i) => {
              const pct = (weight as number / total) * 100;
              const kgVal = hasKg ? (sizeBreakdownKg![size] || (weight as number) * 0.453592) : (weight as number) * 0.453592;
              return (
                <tr key={size} className={i % 2 === 0 ? "bg-card" : "bg-accent/30"}>
                  <td className="px-3 py-2 font-semibold text-foreground">{size}</td>
                  <td className="px-3 py-2 text-right text-foreground">
                    {kgVal.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground">
                    {(weight as number).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {pct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2">
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-border bg-secondary">
              <td className="px-3 py-2 font-bold text-foreground">Total</td>
              <td className="px-3 py-2 text-right font-bold text-foreground">
                {totalKg.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </td>
              <td className="px-3 py-2 text-right font-bold text-foreground">
                {total.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </td>
              <td className="px-3 py-2 text-right font-bold text-foreground">100%</td>
              <td className="px-3 py-2">
                <div className="h-1.5 rounded-full bg-primary" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SizeBreakdownTable;
