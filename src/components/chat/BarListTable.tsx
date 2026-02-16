import React, { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Search, Pencil } from "lucide-react";

const REBAR_UNIT_WEIGHT: Record<string, number> = {
  "#3": 0.376, "#4": 0.668, "#5": 1.043, "#6": 1.502, "#7": 2.044,
  "#8": 2.670, "#9": 3.400, "#10": 4.303, "#11": 5.313, "#14": 7.650, "#18": 13.60,
  "10M": 0.527, "15M": 1.055, "20M": 1.582, "25M": 2.637,
  "30M": 3.692, "35M": 5.274, "45M": 7.914, "55M": 13.186,
};

interface BarItem {
  element_id: string;
  element_type: string;
  bar_mark: string;
  size: string;
  shape_code: string;
  qty: number;
  length_ft: number;
  weight_lbs: number;
  status?: string;
}

interface BarListTableProps {
  barList: BarItem[];
  onShowOnDrawing?: (elementId: string) => void;
  selectedElementId?: string | null;
}

interface EditingCell {
  rowIndex: number;
  field: "qty" | "length_ft" | "size";
}

const BarListTable: React.FC<BarListTableProps> = ({ barList: initialBarList, onShowOnDrawing, selectedElementId }) => {
  const [barList, setBarList] = useState<BarItem[]>(initialBarList);
  const [filter, setFilter] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return barList;
    const q = filter.toLowerCase();
    return barList.filter(
      (b) =>
        b.bar_mark?.toLowerCase().includes(q) ||
        b.size?.toLowerCase().includes(q) ||
        b.element_type?.toLowerCase().includes(q) ||
        b.element_id?.toLowerCase().includes(q)
    );
  }, [barList, filter]);

  const grouped = useMemo(() => {
    const g: Record<string, { bars: BarItem[]; originalIndices: number[] }> = {};
    filtered.forEach((b) => {
      const type = b.element_type || "OTHER";
      if (!g[type]) g[type] = { bars: [], originalIndices: [] };
      g[type].bars.push(b);
      g[type].originalIndices.push(barList.indexOf(b));
    });
    return g;
  }, [filtered, barList]);

  // Initialize all groups as open
  useMemo(() => {
    const keys = Object.keys(grouped);
    setOpenGroups((prev) => {
      const next = { ...prev };
      keys.forEach((k) => { if (!(k in next)) next[k] = true; });
      return next;
    });
  }, [Object.keys(grouped).join(",")]);

  const grandTotal = useMemo(() => {
    return filtered.reduce((sum, b) => sum + (b.weight_lbs || 0), 0);
  }, [filtered]);

  const startEdit = (originalIndex: number, field: EditingCell["field"], currentValue: string | number) => {
    setEditing({ rowIndex: originalIndex, field });
    setEditValue(String(currentValue));
  };

  const commitEdit = () => {
    if (!editing) return;
    const { rowIndex, field } = editing;
    setBarList((prev) => {
      const next = [...prev];
      const bar = { ...next[rowIndex] };
      if (field === "qty") {
        bar.qty = Math.max(1, parseInt(editValue) || 1);
      } else if (field === "length_ft") {
        bar.length_ft = Math.max(0, parseFloat(editValue) || 0);
      } else if (field === "size") {
        bar.size = editValue;
      }
      // Recalculate weight
      const unitWt = REBAR_UNIT_WEIGHT[bar.size] || 0;
      bar.weight_lbs = Math.round(bar.qty * bar.length_ft * unitWt * 100) / 100;
      next[rowIndex] = bar;
      return next;
    });
    setEditing(null);
  };

  const statusBorderColor = (status?: string) => {
    switch (status) {
      case "READY": return "border-l-primary";
      case "FLAGGED": return "border-l-amber-500";
      case "BLOCKED": return "border-l-destructive";
      default: return "border-l-border";
    }
  };

  return (
    <div className="space-y-3">
      {/* Search/Filter */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by bar mark, size, or element type..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-9 h-9 rounded-xl text-xs"
        />
      </div>

      {/* Grouped Tables */}
      <div className="space-y-2">
        {Object.entries(grouped).map(([type, { bars, originalIndices }]) => {
          const subtotal = bars.reduce((s, b) => s + (b.weight_lbs || 0), 0);
          return (
            <Collapsible
              key={type}
              open={openGroups[type]}
              onOpenChange={(open) => setOpenGroups((prev) => ({ ...prev, [type]: open }))}
            >
              <CollapsibleTrigger className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-xl hover:bg-accent/50 transition-colors border border-border bg-card">
                {openGroups[type] ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <span className="text-xs font-bold text-foreground">{type}</span>
                <Badge variant="secondary" className="text-[10px] ml-1 rounded-md">{bars.length}</Badge>
                <span className="ml-auto text-xs font-semibold text-primary">{subtotal.toLocaleString()} lbs</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1">
                <div className="rounded-xl border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-[10px] h-8 px-3">Bar Mark</TableHead>
                        <TableHead className="text-[10px] h-8 px-3">Size</TableHead>
                        <TableHead className="text-[10px] h-8 px-3">Shape</TableHead>
                        <TableHead className="text-[10px] h-8 px-3 text-right">Qty</TableHead>
                        <TableHead className="text-[10px] h-8 px-3 text-right">Length (ft)</TableHead>
                        <TableHead className="text-[10px] h-8 px-3 text-right">Unit Wt</TableHead>
                        <TableHead className="text-[10px] h-8 px-3 text-right">Weight (lbs)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bars.map((bar, i) => {
                        const origIdx = originalIndices[i];
                        const unitWt = REBAR_UNIT_WEIGHT[bar.size] || 0;
                        const isSelected = bar.element_id === selectedElementId;
                        return (
                          <TableRow
                            key={`${bar.element_id}-${bar.bar_mark}-${i}`}
                            className={`cursor-pointer border-l-4 ${statusBorderColor(bar.status)} transition-colors ${
                              isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/50"
                            }`}
                            onClick={() => onShowOnDrawing?.(bar.element_id)}
                          >
                            <TableCell className="text-xs px-3 py-2 font-medium">{bar.bar_mark || "—"}</TableCell>
                            <TableCell className="text-xs px-3 py-2">
                              {editing?.rowIndex === origIdx && editing.field === "size" ? (
                                <Input
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => e.key === "Enter" && commitEdit()}
                                  className="h-6 w-16 text-xs px-1"
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 group/edit cursor-text"
                                  onClick={(e) => { e.stopPropagation(); startEdit(origIdx, "size", bar.size); }}
                                >
                                  {bar.size}
                                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs px-3 py-2 text-muted-foreground">{bar.shape_code || "—"}</TableCell>
                            <TableCell className="text-xs px-3 py-2 text-right">
                              {editing?.rowIndex === origIdx && editing.field === "qty" ? (
                                <Input
                                  type="number"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => e.key === "Enter" && commitEdit()}
                                  className="h-6 w-14 text-xs px-1 text-right ml-auto"
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 justify-end group/edit cursor-text"
                                  onClick={(e) => { e.stopPropagation(); startEdit(origIdx, "qty", bar.qty); }}
                                >
                                  {bar.qty}
                                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs px-3 py-2 text-right">
                              {editing?.rowIndex === origIdx && editing.field === "length_ft" ? (
                                <Input
                                  type="number"
                                  step="0.1"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => e.key === "Enter" && commitEdit()}
                                  className="h-6 w-16 text-xs px-1 text-right ml-auto"
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 justify-end group/edit cursor-text"
                                  onClick={(e) => { e.stopPropagation(); startEdit(origIdx, "length_ft", bar.length_ft); }}
                                >
                                  {bar.length_ft}
                                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs px-3 py-2 text-right text-muted-foreground">{unitWt.toFixed(3)}</TableCell>
                            <TableCell className="text-xs px-3 py-2 text-right font-semibold text-primary">{bar.weight_lbs.toLocaleString()}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>

      {/* Grand Total */}
      <div className="rounded-xl border-2 border-primary bg-primary/5 p-4 flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">Grand Total</span>
        <div className="text-right">
          <p className="text-lg font-bold text-primary">{grandTotal.toLocaleString()} lbs</p>
          <p className="text-xs text-muted-foreground">{(grandTotal / 2000).toFixed(2)} tons</p>
        </div>
      </div>
    </div>
  );
};

export default BarListTable;
