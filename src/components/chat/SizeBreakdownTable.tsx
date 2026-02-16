import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SizeBreakdownTableProps {
  sizeBreakdown: Record<string, number>;
}

const SizeBreakdownTable: React.FC<SizeBreakdownTableProps> = ({ sizeBreakdown }) => {
  const entries = Object.entries(sizeBreakdown);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, w]) => sum + (w as number), 0);

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-foreground mb-1.5">Weight by Rebar Size</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs h-8">Size</TableHead>
            <TableHead className="text-xs h-8 text-right">Weight (lbs)</TableHead>
            <TableHead className="text-xs h-8 text-right">%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([size, weight]) => (
            <TableRow key={size}>
              <TableCell className="text-xs py-1.5 font-medium">{size}</TableCell>
              <TableCell className="text-xs py-1.5 text-right">
                {(weight as number).toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </TableCell>
              <TableCell className="text-xs py-1.5 text-right text-muted-foreground">
                {((weight as number / total) * 100).toFixed(1)}%
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2">
            <TableCell className="text-xs py-1.5 font-semibold">Total</TableCell>
            <TableCell className="text-xs py-1.5 text-right font-semibold">
              {total.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </TableCell>
            <TableCell className="text-xs py-1.5 text-right font-semibold">100%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
};

export default SizeBreakdownTable;
