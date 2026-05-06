import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useState, useMemo } from "react";

export interface EstimateLineItem {
  id: string;
  elementId: string;
  elementType: string;
  status: "approved" | "needs_review" | "blocked";
  evidenceGrade: string;
  weightKg: number;
  costEstimate: number;
  issuesCount: number;
  questionsCount: number;
  sourceSheets: string[];
}

interface EstimateGridProps {
  items: EstimateLineItem[];
  selectedId: string | null;
  onSelectRow: (id: string) => void;
  currency?: string;
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  approved: { label: "Approved", className: "bg-[hsl(var(--status-approved)/.12)] text-[hsl(var(--status-approved))] border-[hsl(var(--status-approved)/.2)]" },
  needs_review: { label: "Review", className: "bg-[hsl(var(--status-review)/.12)] text-[hsl(var(--status-review))] border-[hsl(var(--status-review)/.2)]" },
  blocked: { label: "Blocked", className: "bg-[hsl(var(--status-blocked)/.12)] text-[hsl(var(--status-blocked))] border-[hsl(var(--status-blocked)/.2)]" },
};

type SortKey = "elementId" | "elementType" | "status" | "weightKg" | "costEstimate" | "issuesCount";

export default function EstimateGrid({ items, selectedId, onSelectRow, currency = "CAD" }: EstimateGridProps) {
  const [sortKey, setSortKey] = useState<SortKey>("elementId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" ? (av as number) - (bv as number) : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, sortKey, sortDir]);

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null;

  const fmt = (v: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);

  return (
    <div className="overflow-auto flex-1 border rounded-lg">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <TableRow className="text-[11px] uppercase tracking-wider">
            <TableHead className="cursor-pointer w-[100px]" onClick={() => toggleSort("elementId")}>
              <span className="flex items-center gap-1">ID <SortIcon col="elementId" /></span>
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => toggleSort("elementType")}>
              <span className="flex items-center gap-1">Type <SortIcon col="elementType" /></span>
            </TableHead>
            <TableHead className="cursor-pointer w-[90px]" onClick={() => toggleSort("status")}>
              <span className="flex items-center gap-1">Status <SortIcon col="status" /></span>
            </TableHead>
            <TableHead className="w-[60px]">Grade</TableHead>
            <TableHead className="cursor-pointer text-right w-[90px]" onClick={() => toggleSort("weightKg")}>
              <span className="flex items-center justify-end gap-1">Weight <SortIcon col="weightKg" /></span>
            </TableHead>
            <TableHead className="cursor-pointer text-right w-[100px]" onClick={() => toggleSort("costEstimate")}>
              <span className="flex items-center justify-end gap-1">Cost <SortIcon col="costEstimate" /></span>
            </TableHead>
            <TableHead className="cursor-pointer text-right w-[60px]" onClick={() => toggleSort("issuesCount")}>
              <span className="flex items-center justify-end gap-1">Issues <SortIcon col="issuesCount" /></span>
            </TableHead>
            <TableHead className="text-right w-[40px]">Q</TableHead>
            <TableHead className="w-[80px]">Sheets</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((item) => {
            const s = STATUS_MAP[item.status] || STATUS_MAP.needs_review;
            return (
              <TableRow
                key={item.id}
                onClick={() => onSelectRow(item.id)}
                className={`cursor-pointer text-xs h-9 ${selectedId === item.id ? "bg-accent" : "hover:bg-muted/30"}`}
              >
                <TableCell className="font-mono text-xs py-1.5 px-3">{item.elementId}</TableCell>
                <TableCell className="py-1.5 px-3">{item.elementType}</TableCell>
                <TableCell className="py-1.5 px-3">
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${s.className}`}>{s.label}</Badge>
                </TableCell>
                <TableCell className="py-1.5 px-3 text-muted-foreground">{item.evidenceGrade}</TableCell>
                <TableCell className="text-right py-1.5 px-3 font-mono">{item.weightKg.toLocaleString()} kg</TableCell>
                <TableCell className="text-right py-1.5 px-3 font-mono">{fmt(item.costEstimate)}</TableCell>
                <TableCell className="text-right py-1.5 px-3">
                  {item.issuesCount > 0 && <span className="text-[hsl(var(--status-blocked))] font-medium">{item.issuesCount}</span>}
                </TableCell>
                <TableCell className="text-right py-1.5 px-3">
                  {item.questionsCount > 0 && <span className="text-[hsl(var(--status-review))] font-medium">{item.questionsCount}</span>}
                </TableCell>
                <TableCell className="py-1.5 px-3 text-muted-foreground text-[10px]">{item.sourceSheets.join(", ")}</TableCell>
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                No estimate line items yet. Run a takeoff to populate.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
