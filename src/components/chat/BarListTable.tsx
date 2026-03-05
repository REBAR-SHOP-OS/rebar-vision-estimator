import React, { useState, useMemo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Search, Pencil, Upload, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  getMassKgPerM,
  getWeightLbPerFt,
  detectLengthUnit,
  toMm,
  computeItemWeightKg,
  kgToLbs,
  type LengthUnit,
} from "@/lib/rebar-weights";

export interface BarItem {
  element_id: string;
  element_type: string;
  bar_mark: string;
  size: string;
  shape_code: string;
  qty: number;
  multiplier: number;
  length_mm: number;
  length_ft: number;
  weight_kg: number;
  weight_lbs: number;
  assumptions: string[];
  status?: string;
}

interface BarListTableProps {
  barList: BarItem[];
  onShowOnDrawing?: (elementId: string) => void;
  selectedElementId?: string | null;
  onImport?: (data: BarItem[]) => void;
}

interface EditingCell {
  rowIndex: number;
  field: "qty" | "length_ft" | "size";
}

// ── Header mapping helpers ──────────────────────────────────────

const SIZE_HEADERS = ["SIZE", "size", "DIA", "dia", "DIAMETER", "BAR SIZE", "REBAR SIZE"];
const QTY_HEADERS = ["QUANTITY", "quantity", "QTY", "qty", "NO.", "NO", "COUNT"];
const LENGTH_HEADERS = ["TOTAL LENGTH", "total_length", "LENGTH", "length", "TOTAL LEN", "CUT LENGTH", "TOT. LENGTH", "TOT LENGTH"];
const MULTIPLIER_HEADERS = ["MULTIPLIER", "multiplier", "MULTI", "NO. OF MEMBERS", "NO OF MEMBERS", "NO OF MEM", "MEMBERS", "MEM"];
const MARK_HEADERS = ["MARK", "mark", "BAR MARK", "BAR_MARK", "ITEM"];
const ELEMENT_HEADERS = ["DWG #", "DWG", "dwg", "ELEMENT", "ELEMENT ID"];
const DESC_HEADERS = ["ADD", "DESCRIPTION", "ITEM", "TYPE", "ELEMENT TYPE"];
const SHAPE_HEADERS = ["TYPE", "type", "SHAPE", "shape_code", "SHAPE CODE", "BEND TYPE"];

function findHeader(row: Record<string, any>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (row[c] !== undefined) return c;
  }
  // Case-insensitive fallback
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find((k) => k.toLowerCase().trim() === c.toLowerCase().trim());
    if (found) return found;
  }
  return undefined;
}

function parseNumericValue(val: any): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    // If it's a formula string (starts with =), we can't evaluate it — return 0
    if (val.trim().startsWith("=")) return 0;
    const cleaned = val.replace(/[,\s]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

// ── Cross-check: find "TOTAL WEIGHT" cell in worksheet ──────────

function findExcelTotalWeight(ws: XLSX.WorkSheet): number | null {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "string" && /total\s*(weight|wt|mass)/i.test(cell.v)) {
        // Check adjacent cells (right, then below) for a number
        for (const [dr, dc] of [[0, 1], [0, 2], [1, 0]]) {
          const adj = ws[XLSX.utils.encode_cell({ r: r + dr, c: c + dc })];
          if (adj && typeof adj.v === "number") return adj.v;
        }
      }
    }
  }
  return null;
}

// ── Main parser ─────────────────────────────────────────────────

interface ParseResult {
  items: BarItem[];
  diagnostics: {
    detectedUnit: LengthUnit;
    unitAssumed: boolean;
    rowCount: number;
    missingSizes: string[];
    formulaFallbacks: number;
    excelTotalWeight: number | null;
    computedTotalKg: number;
    mismatchPct: number | null;
    assumptions: string[];
  };
}

function parseXlsxToBarItems(data: any[], ws: XLSX.WorkSheet): ParseResult {
  if (data.length === 0) return { items: [], diagnostics: { detectedUnit: "mm", unitAssumed: true, rowCount: 0, missingSizes: [], formulaFallbacks: 0, excelTotalWeight: null, computedTotalKg: 0, mismatchPct: null, assumptions: [] } };

  const headers = Object.keys(data[0]);
  const { unit: detectedUnit, assumed: unitAssumed } = detectLengthUnit(headers);

  const sizeKey = findHeader(data[0], SIZE_HEADERS);
  const qtyKey = findHeader(data[0], QTY_HEADERS);
  const lengthKey = findHeader(data[0], LENGTH_HEADERS);
  const multiplierKey = findHeader(data[0], MULTIPLIER_HEADERS);
  const markKey = findHeader(data[0], MARK_HEADERS);
  const elementKey = findHeader(data[0], ELEMENT_HEADERS);
  const descKey = findHeader(data[0], DESC_HEADERS);
  const shapeKey = findHeader(data[0], SHAPE_HEADERS);

  const missingSizes: string[] = [];
  let formulaFallbacks = 0;
  const globalAssumptions: string[] = [];
  if (unitAssumed) globalAssumptions.push(`Unit assumed: ${detectedUnit}`);

  const items: BarItem[] = data.map((row, i) => {
    const size = String(sizeKey ? row[sizeKey] : "").trim();
    const assumptions: string[] = [];

    // Parse qty
    let qty = parseNumericValue(qtyKey ? row[qtyKey] : 1);
    if (qty <= 0) qty = 1;

    // Parse multiplier
    let multiplier = 1;
    if (multiplierKey && row[multiplierKey] !== undefined) {
      multiplier = parseNumericValue(row[multiplierKey]);
      if (multiplier <= 0) multiplier = 1;
    }

    // Parse length and normalize to mm
    let rawLength = lengthKey ? row[lengthKey] : 0;
    if (typeof rawLength === "string" && rawLength.trim().startsWith("=")) {
      formulaFallbacks++;
      assumptions.push("Formula could not be evaluated");
      rawLength = 0;
    }
    const lengthValue = parseNumericValue(rawLength);
    const length_mm = toMm(lengthValue, detectedUnit);

    // Compute weight in kg using CSA table
    const massKgM = getMassKgPerM(size);
    if (massKgM === 0 && size) {
      missingSizes.push(size);
      assumptions.push(`Unknown size: ${size}`);
    }

    const weight_kg = computeItemWeightKg({ size, qty, multiplier, length_mm });
    const weight_lbs = kgToLbs(weight_kg);
    const length_ft = Math.round((length_mm / 304.8) * 100) / 100;

    const shapeType = String(shapeKey ? row[shapeKey] : "").trim();

    return {
      element_id: String(elementKey ? row[elementKey] : `ROW-${i + 1}`).trim(),
      element_type: String(descKey ? row[descKey] : "REBAR").trim(),
      bar_mark: String(markKey ? row[markKey] : `M${i + 1}`).trim(),
      size,
      shape_code: shapeType || "straight",
      qty,
      multiplier,
      length_mm,
      length_ft,
      weight_kg: Math.round(weight_kg * 100) / 100,
      weight_lbs: Math.round(weight_lbs * 100) / 100,
      assumptions: [...globalAssumptions, ...assumptions],
    };
  });

  const computedTotalKg = items.reduce((sum, b) => sum + b.weight_kg, 0);
  const excelTotalWeight = findExcelTotalWeight(ws);
  let mismatchPct: number | null = null;
  if (excelTotalWeight !== null && excelTotalWeight > 0) {
    mismatchPct = Math.abs(computedTotalKg - excelTotalWeight) / excelTotalWeight * 100;
  }

  return {
    items,
    diagnostics: {
      detectedUnit,
      unitAssumed,
      rowCount: items.length,
      missingSizes: [...new Set(missingSizes)],
      formulaFallbacks,
      excelTotalWeight,
      computedTotalKg,
      mismatchPct,
      assumptions: globalAssumptions,
    },
  };
}

// ── Component ───────────────────────────────────────────────────

const BarListTable: React.FC<BarListTableProps> = ({ barList: initialBarList, onShowOnDrawing, selectedElementId, onImport }) => {
  const [barList, setBarList] = useState<BarItem[]>(initialBarList);
  const [filter, setFilter] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

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

  useMemo(() => {
    const keys = Object.keys(grouped);
    setOpenGroups((prev) => {
      const next = { ...prev };
      keys.forEach((k) => { if (!(k in next)) next[k] = true; });
      return next;
    });
  }, [Object.keys(grouped).join(",")]);

  const grandTotalKg = useMemo(() => filtered.reduce((sum, b) => sum + (b.weight_kg || 0), 0), [filtered]);
  const grandTotalLbs = useMemo(() => filtered.reduce((sum, b) => sum + (b.weight_lbs || 0), 0), [filtered]);

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
        bar.length_mm = bar.length_ft * 304.8;
      } else if (field === "size") {
        bar.size = editValue;
      }
      // Recalculate weight using correct formula
      bar.weight_kg = computeItemWeightKg({ size: bar.size, qty: bar.qty, multiplier: bar.multiplier || 1, length_mm: bar.length_mm });
      bar.weight_kg = Math.round(bar.weight_kg * 100) / 100;
      bar.weight_lbs = Math.round(kgToLbs(bar.weight_kg) * 100) / 100;
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

  const xlsxInputRef = useRef<HTMLInputElement>(null);

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws);
        if (!raw.length) { toast.error("No data found in the file"); return; }

        const { items, diagnostics } = parseXlsxToBarItems(raw, ws);
        setBarList(items);
        onImport?.(items);

        // Build warnings
        const warnings: string[] = [];
        if (diagnostics.unitAssumed) warnings.push(`⚠ Length unit assumed: ${diagnostics.detectedUnit}`);
        if (diagnostics.missingSizes.length > 0) warnings.push(`⚠ Unknown sizes: ${diagnostics.missingSizes.join(", ")}`);
        if (diagnostics.formulaFallbacks > 0) warnings.push(`⚠ ${diagnostics.formulaFallbacks} formula(s) could not be evaluated`);
        if (diagnostics.mismatchPct !== null && diagnostics.mismatchPct > 1) {
          warnings.push(`⚠ Weight mismatch: computed ${diagnostics.computedTotalKg.toFixed(1)} kg vs Excel total ${diagnostics.excelTotalWeight?.toFixed(1)} kg (${diagnostics.mismatchPct.toFixed(1)}% off)`);
        }

        setImportWarnings(warnings);

        if (warnings.length > 0) {
          toast.warning(`Imported ${items.length} items with ${warnings.length} warning(s)`, {
            description: warnings.join("\n"),
            duration: 10000,
          });
        } else {
          toast.success(`Imported ${items.length} bar items — ${diagnostics.computedTotalKg.toFixed(1)} kg total`);
        }
      } catch {
        toast.error("Failed to parse the Excel file");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      {/* Import Warnings Banner */}
      {importWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Import Diagnostics
          </div>
          {importWarnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-300">{w}</p>
          ))}
        </div>
      )}

      {/* Search/Filter + Import */}
      <div className="flex flex-col xs:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by bar mark, size, or element type..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-9 h-9 rounded-xl text-xs"
          />
        </div>
        <input ref={xlsxInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileImport} />
        <Button variant="outline" size="sm" className="h-9 rounded-xl text-xs gap-1.5" onClick={() => xlsxInputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" />
          Import
        </Button>
      </div>

      {/* Grouped Tables */}
      <div className="space-y-2">
        {Object.entries(grouped).map(([type, { bars, originalIndices }]) => {
          const subtotalKg = bars.reduce((s, b) => s + (b.weight_kg || 0), 0);
          const subtotalLbs = bars.reduce((s, b) => s + (b.weight_lbs || 0), 0);
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
                <span className="ml-auto text-xs font-semibold text-primary">
                  {subtotalKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                  <span className="text-muted-foreground ml-1">({subtotalLbs.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs)</span>
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1">
                <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-[10px] h-8 px-3">Bar Mark</TableHead>
                        <TableHead className="text-[10px] h-8 px-3">Size</TableHead>
                        <TableHead className="text-[10px] h-8 px-3">Shape</TableHead>
                        <TableHead className="text-[10px] h-8 px-3 text-right">Qty</TableHead>
                        <TableHead className="text-[10px] h-8 px-3 text-right">Multi</TableHead>
                        <TableHead className="text-[10px] h-8 px-3 text-right">Length (mm)</TableHead>
                        <TableHead className="text-[10px] h-8 px-3 text-right">Wt (kg/m)</TableHead>
                        <TableHead className="text-[10px] h-8 px-3 text-right">Weight (kg)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bars.map((bar, i) => {
                        const origIdx = originalIndices[i];
                        const unitWtKgM = getMassKgPerM(bar.size);
                        const isSelected = bar.element_id === selectedElementId;
                        const hasWarnings = bar.assumptions && bar.assumptions.length > 0;
                        return (
                          <TableRow
                            key={`${bar.element_id}-${bar.bar_mark}-${i}`}
                            className={`cursor-pointer border-l-4 ${statusBorderColor(bar.status)} transition-colors ${
                              isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/50"
                            } ${hasWarnings ? "bg-amber-500/5" : ""}`}
                            onClick={() => onShowOnDrawing?.(bar.element_id)}
                          >
                            <TableCell className="text-xs px-3 py-2 font-medium">
                              {bar.bar_mark || "—"}
                              {hasWarnings && <AlertTriangle className="inline h-3 w-3 ml-1 text-amber-500" />}
                            </TableCell>
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
                            <TableCell className="text-xs px-3 py-2 text-right text-muted-foreground">{bar.multiplier > 1 ? `×${bar.multiplier}` : "—"}</TableCell>
                            <TableCell className="text-xs px-3 py-2 text-right">
                              {editing?.rowIndex === origIdx && editing.field === "length_ft" ? (
                                <Input
                                  type="number"
                                  step="0.1"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => e.key === "Enter" && commitEdit()}
                                  className="h-6 w-20 text-xs px-1 text-right ml-auto"
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 justify-end group/edit cursor-text"
                                  onClick={(e) => { e.stopPropagation(); startEdit(origIdx, "length_ft", bar.length_mm); }}
                                >
                                  {bar.length_mm.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs px-3 py-2 text-right text-muted-foreground">{unitWtKgM.toFixed(3)}</TableCell>
                            <TableCell className="text-xs px-3 py-2 text-right font-semibold text-primary">
                              {bar.weight_kg.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                            </TableCell>
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
          <p className="text-lg font-bold text-primary">
            {grandTotalKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
          </p>
          <p className="text-xs text-muted-foreground">
            {(grandTotalKg / 1000).toFixed(2)} tonnes &middot; {grandTotalLbs.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs ({(grandTotalLbs / 2000).toFixed(2)} tons)
          </p>
        </div>
      </div>
    </div>
  );
};

export default BarListTable;
