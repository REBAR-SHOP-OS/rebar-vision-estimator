import React, { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Search, Pencil } from "lucide-react";

interface BarItem {
  element_id: string;
  element_type: string;
  bar_mark: string;
  size: string;
  shape_code: string;
  qty: number;
  length_ft: number;
  weight_lbs: number;
  leg_a?: number;
  leg_b?: number;
  leg_c?: number;
}

interface BendingScheduleTableProps {
  barList: BarItem[];
  onShowOnDrawing?: (elementId: string) => void;
  selectedElementId?: string | null;
}

interface EditingCell {
  index: number;
  field: "qty" | "leg_a" | "leg_b" | "leg_c";
}

const BendingScheduleTable: React.FC<BendingScheduleTableProps> = ({ barList, onShowOnDrawing, selectedElementId }) => {
  const [filter, setFilter] = useState("");
  const [localBars, setLocalBars] = useState<BarItem[]>(() =>
    barList.filter((b) => b.shape_code && b.shape_code !== "straight" && b.shape_code !== "closed")
  );
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return localBars;
    const q = filter.toLowerCase();
    return localBars.filter(
      (b) =>
        b.bar_mark?.toLowerCase().includes(q) ||
        b.size?.toLowerCase().includes(q) ||
        b.shape_code?.toLowerCase().includes(q) ||
        b.element_id?.toLowerCase().includes(q)
    );
  }, [localBars, filter]);

  const startEdit = (index: number, field: EditingCell["field"], value: string | number | undefined) => {
    setEditing({ index, field });
    setEditValue(String(value ?? ""));
  };

  const commitEdit = () => {
    if (!editing) return;
    const { index, field } = editing;
    setLocalBars((prev) => {
      const next = [...prev];
      const bar = { ...next[index] };
      if (field === "qty") bar.qty = Math.max(1, parseInt(editValue) || 1);
      else bar[field] = parseFloat(editValue) || 0;
      next[index] = bar;
      return next;
    });
    setEditing(null);
  };

  if (localBars.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">No bent bars detected in this project.</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Only bars with shape codes other than "straight" or "closed" appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter bent bars..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-9 h-9 rounded-xl text-xs"
        />
      </div>

      <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[10px] h-8 px-3">Element</TableHead>
              <TableHead className="text-[10px] h-8 px-3">Bar Mark</TableHead>
              <TableHead className="text-[10px] h-8 px-3">Size</TableHead>
              <TableHead className="text-[10px] h-8 px-3">Shape</TableHead>
              <TableHead className="text-[10px] h-8 px-3 text-right">Qty</TableHead>
              <TableHead className="text-[10px] h-8 px-3 text-right">Leg A</TableHead>
              <TableHead className="text-[10px] h-8 px-3 text-right">Leg B</TableHead>
              <TableHead className="text-[10px] h-8 px-3 text-right">Leg C</TableHead>
              <TableHead className="text-[10px] h-8 px-3 text-right">Weight</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((bar, i) => {
              const realIdx = localBars.indexOf(bar);
              const isSelected = bar.element_id === selectedElementId;
              const renderEditable = (field: "qty" | "leg_a" | "leg_b" | "leg_c", value: number | undefined) => {
                if (editing?.index === realIdx && editing.field === field) {
                  return (
                    <Input
                      type="number"
                      step={field === "qty" ? "1" : "0.1"}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => e.key === "Enter" && commitEdit()}
                      className="h-6 w-14 text-xs px-1 text-right ml-auto"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  );
                }
                return (
                  <span
                    className="inline-flex items-center gap-1 justify-end group/edit cursor-text"
                    onClick={(e) => { e.stopPropagation(); startEdit(realIdx, field, value); }}
                  >
                    {value ?? "—"}
                    <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                  </span>
                );
              };

              return (
                <TableRow
                  key={`${bar.element_id}-${bar.bar_mark}-${i}`}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/50"
                  }`}
                  onClick={() => onShowOnDrawing?.(bar.element_id)}
                >
                  <TableCell className="text-xs px-3 py-2 font-medium">{bar.element_id}</TableCell>
                  <TableCell className="text-xs px-3 py-2">{bar.bar_mark || "—"}</TableCell>
                  <TableCell className="text-xs px-3 py-2">{bar.size}</TableCell>
                  <TableCell className="text-xs px-3 py-2">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent text-[10px] font-semibold">{bar.shape_code}</span>
                  </TableCell>
                  <TableCell className="text-xs px-3 py-2 text-right">{renderEditable("qty", bar.qty)}</TableCell>
                  <TableCell className="text-xs px-3 py-2 text-right">{renderEditable("leg_a", bar.leg_a)}</TableCell>
                  <TableCell className="text-xs px-3 py-2 text-right">{renderEditable("leg_b", bar.leg_b)}</TableCell>
                  <TableCell className="text-xs px-3 py-2 text-right">{renderEditable("leg_c", bar.leg_c)}</TableCell>
                  <TableCell className="text-xs px-3 py-2 text-right font-semibold text-primary">{bar.weight_lbs?.toLocaleString() ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default BendingScheduleTable;
