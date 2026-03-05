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

const SIZE_HEADERS = ["SIZE", "size", "DIA", "dia", "DIAMETER", "BAR SIZE", "REBAR SIZE", "BAR DIA", "bar dia"];
const QTY_HEADERS = ["QUANTITY", "quantity", "QTY", "qty", "NO.", "NO", "COUNT"];
const LENGTH_HEADERS = ["TOTAL LENGTH", "total_length", "LENGTH", "length", "TOTAL LEN", "CUT LENGTH", "TOT. LENGTH", "TOT LENGTH", "LENGTH IN MILLIMETERS"];
const MULTIPLIER_HEADERS = ["MULTIPLIER", "multiplier", "MULTI", "MULTI-PLIER", "NO. OF MEMBERS", "NO OF MEMBERS", "NO OF MEM", "MEMBERS", "MEM"];
const MARK_HEADERS = ["MARK", "mark", "BAR MARK", "BAR_MARK", "ITEM", "INDENTIFICATION", "IDENTIFICATION"];
const ELEMENT_HEADERS = ["DWG #", "DWG", "dwg", "ELEMENT", "ELEMENT ID"];
const DESC_HEADERS = ["ADD", "DESCRIPTION", "ITEM", "TYPE", "ELEMENT TYPE"];
const SHAPE_HEADERS = ["TYPE", "type", "SHAPE", "shape_code", "SHAPE CODE", "BEND TYPE", "BEND"];
const WEIGHT_HEADERS = ["TOTAL WGT", "TOTAL WEIGHT", "WEIGHT KG", "WGT", "WEIGHT"];
const REF_HEADERS = ["@", "SHEET", "REF", "REFERENCE"];
const INFO_HEADERS = ["INFO", "PLACEMENT"];

function findHeader(row: Record<string, any>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (row[c] !== undefined) return c;
  }
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
    elementSummary: Record<string, number>;
    weightMismatches: number;
  };
}

// ── Complex parser: array-of-arrays approach for multi-row headers ──

interface ColMap {
  slNo: number;
  identification: number;
  multiplier: number;
  qty: number;
  size: number;
  lengthFt: number;
  lengthMm: number;
  bend: number;
  info: number;
  ref: number;
  totalLengthM: number;
  weightKg: number;
  notes: number;
}

function matchHeader(cellVal: string, candidates: string[]): boolean {
  const v = cellVal.toLowerCase().trim();
  return candidates.some(c => v.includes(c.toLowerCase()));
}

function tryParseComplexXlsx(ws: XLSX.WorkSheet): ParseResult | null {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (rows.length < 5) return null;

  // Find header row: look for a row containing "Qty" AND ("Bar Dia" OR size-like header)
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r];
    if (!row) continue;
    const cells = row.map((c: any) => String(c ?? "").trim());
    const hasQty = cells.some(c => /^qty$/i.test(c));
    const hasSize = cells.some(c => /bar\s*dia/i.test(c) || /^size$/i.test(c) || /^dia$/i.test(c));
    if (hasQty && hasSize) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx < 0) return null;

  // Merge with row above if it has partial labels (multi-row header)
  const headerRow = rows[headerRowIdx].map((c: any) => String(c ?? "").trim());
  let mergedHeaders = [...headerRow];
  if (headerRowIdx > 0) {
    const above = rows[headerRowIdx - 1];
    if (above) {
      for (let c = 0; c < Math.max(headerRow.length, above.length); c++) {
        const top = String(above[c] ?? "").trim();
        const bot = String(headerRow[c] ?? "").trim();
        if (top && bot) {
          mergedHeaders[c] = top + bot; // e.g. "Multi-" + "plier" = "Multi-plier"
        } else if (top && !bot) {
          mergedHeaders[c] = top;
        }
      }
    }
  }

  // Also check row below header for sub-labels (like "feet inches", "millimeters", "kg")
  const subRow = rows[headerRowIdx + 1];
  const subLabels = subRow ? subRow.map((c: any) => String(c ?? "").trim()) : [];

  // Build column map
  const colMap: ColMap = {
    slNo: -1, identification: -1, multiplier: -1, qty: -1, size: -1,
    lengthFt: -1, lengthMm: -1, bend: -1, info: -1, ref: -1,
    totalLengthM: -1, weightKg: -1, notes: -1,
  };

  for (let c = 0; c < mergedHeaders.length; c++) {
    const h = mergedHeaders[c].toLowerCase();
    const sub = (subLabels[c] || "").toLowerCase();
    if (/sl\.?\s*no/i.test(h)) colMap.slNo = c;
    else if (/indentification|identification/i.test(h) || /indentification|identification/i.test(mergedHeaders[c])) colMap.identification = c;
    else if (/multi/i.test(h)) colMap.multiplier = c;
    else if (/^qty$/i.test(h) || /quantity/i.test(h)) colMap.qty = c;
    else if (/bar\s*dia/i.test(h) || /^size$/i.test(h)) colMap.size = c;
    else if (/length/i.test(h) && (sub.includes("feet") || sub.includes("ft") || h.includes("feet"))) colMap.lengthFt = c;
    else if (/length/i.test(h) && (sub.includes("mill") || sub.includes("mm") || h.includes("mill"))) colMap.lengthMm = c;
    else if (/bend/i.test(h) || /shape/i.test(h)) colMap.bend = c;
    else if (/^info$/i.test(h) || /placement/i.test(h)) colMap.info = c;
    else if (/^@/i.test(h) || /sheet/i.test(h) || /^ref$/i.test(h)) colMap.ref = c;
    else if (/total\s*length/i.test(h) || /mtr/i.test(h)) colMap.totalLengthM = c;
    else if (/total\s*wgt|total\s*weight|wgt/i.test(h) || sub.includes("kg")) colMap.weightKg = c;
    else if (/notes/i.test(h)) colMap.notes = c;
  }

  // Check for second "Length in" column: if two adjacent "Length in" columns, 
  // first is ft, second is mm based on sub-row
  if (colMap.lengthMm < 0 || colMap.lengthFt < 0) {
    // Try finding two adjacent "length in" columns
    for (let c = 0; c < mergedHeaders.length - 1; c++) {
      if (/length\s*in/i.test(mergedHeaders[c]) && /length\s*in/i.test(mergedHeaders[c + 1])) {
        const sub0 = (subLabels[c] || "").toLowerCase();
        const sub1 = (subLabels[c + 1] || "").toLowerCase();
        if (sub0.includes("feet") || sub0.includes("ft")) { colMap.lengthFt = c; colMap.lengthMm = c + 1; }
        else if (sub1.includes("feet") || sub1.includes("ft")) { colMap.lengthFt = c + 1; colMap.lengthMm = c; }
        else { colMap.lengthFt = c; colMap.lengthMm = c + 1; } // assume order
        break;
      }
    }
  }

  // Also try to find identification from the sub-row if not found
  if (colMap.identification < 0) {
    for (let c = 0; c < subLabels.length; c++) {
      if (/indentification|identification/i.test(subLabels[c])) {
        colMap.identification = c;
        break;
      }
    }
  }

  // Need at minimum qty + size to proceed
  if (colMap.qty < 0 || colMap.size < 0) return null;

  // Determine data start row (skip the sub-header row)
  let dataStartRow = headerRowIdx + 1;
  // If the row after header is the sub-label row (contains "plier", "millimeters", etc.), skip it
  if (subLabels.some(s => /plier|millimeters|feet|kg/i.test(s))) {
    dataStartRow = headerRowIdx + 2;
  }

  // Detect metric context from headers
  const isMetric = mergedHeaders.some(h => /mill|mm|mtr|meter|metre/i.test(h)) ||
    subLabels.some(s => /mill|mm/i.test(s));

  // Parse data rows
  const items: BarItem[] = [];
  let currentElementType = "OTHER";
  let currentElementId = "";
  const missingSizes: string[] = [];
  let formulaFallbacks = 0;
  let weightMismatches = 0;
  const elementSummary: Record<string, number> = {};
  const globalAssumptions: string[] = [];

  for (let r = dataStartRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    // Count non-empty cells (ignore SL.No. column)
    const nonEmpty = row.filter((c: any, idx: number) => {
      if (idx === colMap.slNo) return false;
      return c !== null && c !== undefined && String(c).trim() !== "";
    });

    if (nonEmpty.length === 0) continue;

    // Check if this is a "TOTAL WEIGHT" row at the end
    const rowStr = row.map((c: any) => String(c ?? "")).join(" ").toLowerCase();
    if (/total\s*weight/i.test(rowStr) && nonEmpty.length <= 3) continue;

    // Check if this is a section header (only 1-2 non-empty cells, text-only, in identification column or first few cols)
    const qtyVal = row[colMap.qty];
    const sizeVal = row[colMap.size];
    const hasQty = qtyVal !== null && qtyVal !== undefined && String(qtyVal).trim() !== "" && !isNaN(Number(qtyVal));
    const hasSize = sizeVal !== null && sizeVal !== undefined && String(sizeVal).trim() !== "" && !isNaN(Number(sizeVal));

    if (!hasQty && !hasSize) {
      // This is likely a section or sub-section header
      const idCell = String(row[colMap.identification] ?? "").trim();
      if (idCell) {
        // Determine if it's a major section or sub-section
        const SECTION_KEYWORDS = [
          "RAFT SLAB", "WALL", "GROUND FLOOR SLAB", "GRADE BEAMS", "PIERS",
          "CABANA GRADE BEAMS", "CABANA WALLS", "CABANA WALL", "FOUNDATION",
          "FOOTING", "COLUMN", "BEAM", "STAIR", "ELEVATOR", "SLAB"
        ];
        const upper = idCell.toUpperCase();
        const isSection = SECTION_KEYWORDS.some(kw => upper === kw || upper.startsWith(kw + " "));
        
        // A major section header typically has very few filled cells and matches known section names
        if (nonEmpty.length <= 2 && isSection && !upper.includes("@") && !upper.includes("OC")) {
          currentElementType = idCell;
          currentElementId = "";
        } else {
          // Sub-section (element ID)
          currentElementId = idCell;
        }
      }
      continue;
    }

    // Parse data row
    const assumptions: string[] = [];
    
    let size = String(sizeVal ?? "").trim();
    // If bare number in metric context, append "M"
    if (isMetric && /^\d+$/.test(size)) {
      size = size + "M";
    }

    let qty = parseNumericValue(qtyVal);
    if (qty <= 0) qty = 1;

    let multiplier = 1;
    if (colMap.multiplier >= 0 && row[colMap.multiplier] !== undefined) {
      const mv = parseNumericValue(row[colMap.multiplier]);
      if (mv > 0) multiplier = mv;
    }

    // Prefer mm length column
    let length_mm = 0;
    if (colMap.lengthMm >= 0) {
      const mmVal = row[colMap.lengthMm];
      if (mmVal !== null && mmVal !== undefined && String(mmVal).trim() !== "") {
        length_mm = parseNumericValue(mmVal);
      }
    }
    // Fallback to ft column
    if (length_mm === 0 && colMap.lengthFt >= 0) {
      const ftVal = parseNumericValue(row[colMap.lengthFt]);
      if (ftVal > 0) length_mm = toMm(ftVal, "ft");
    }

    const identification = colMap.identification >= 0 ? String(row[colMap.identification] ?? "").trim() : "";
    const bend = colMap.bend >= 0 ? String(row[colMap.bend] ?? "").trim() : "";
    const info = colMap.info >= 0 ? String(row[colMap.info] ?? "").trim() : "";
    const ref = colMap.ref >= 0 ? String(row[colMap.ref] ?? "").trim() : "";

    // Pre-computed weight from spreadsheet
    let xlsxWeightKg = 0;
    if (colMap.weightKg >= 0) {
      xlsxWeightKg = parseNumericValue(row[colMap.weightKg]);
    }

    // Compute weight
    const massKgM = getMassKgPerM(size);
    if (massKgM === 0 && size) {
      missingSizes.push(size);
      assumptions.push(`Unknown size: ${size}`);
    }

    let weight_kg: number;
    if (xlsxWeightKg > 0) {
      // Use pre-computed weight from spreadsheet
      weight_kg = xlsxWeightKg;
      // Cross-check
      const computed = computeItemWeightKg({ size, qty, multiplier, length_mm });
      if (computed > 0 && Math.abs(computed - xlsxWeightKg) / xlsxWeightKg > 0.02) {
        weightMismatches++;
        assumptions.push(`Weight cross-check: computed ${computed.toFixed(1)} vs XLSX ${xlsxWeightKg.toFixed(1)} kg`);
      }
    } else {
      weight_kg = computeItemWeightKg({ size, qty, multiplier, length_mm });
    }

    const weight_lbs = kgToLbs(weight_kg);
    const length_ft = Math.round((length_mm / 304.8) * 100) / 100;

    // Determine element_id: use sub-section if set, otherwise use identification
    const elementId = currentElementId || identification || `ROW-${r + 1}`;
    const barMark = identification || `M${items.length + 1}`;

    const item: BarItem = {
      element_id: elementId,
      element_type: currentElementType,
      bar_mark: barMark,
      size,
      shape_code: bend || "straight",
      qty,
      multiplier,
      length_mm,
      length_ft,
      weight_kg: Math.round(weight_kg * 100) / 100,
      weight_lbs: Math.round(weight_lbs * 100) / 100,
      assumptions: [...globalAssumptions, ...assumptions],
    };

    items.push(item);

    // Track element summary
    if (!elementSummary[currentElementType]) elementSummary[currentElementType] = 0;
    elementSummary[currentElementType] += weight_kg;
  }

  if (items.length === 0) return null;

  const computedTotalKg = items.reduce((sum, b) => sum + b.weight_kg, 0);
  const excelTotalWeight = findExcelTotalWeight(ws);
  let mismatchPct: number | null = null;
  if (excelTotalWeight !== null && excelTotalWeight > 0) {
    mismatchPct = Math.abs(computedTotalKg - excelTotalWeight) / excelTotalWeight * 100;
  }

  return {
    items,
    diagnostics: {
      detectedUnit: "mm" as LengthUnit,
      unitAssumed: false,
      rowCount: items.length,
      missingSizes: [...new Set(missingSizes)],
      formulaFallbacks,
      excelTotalWeight,
      computedTotalKg,
      mismatchPct,
      assumptions: globalAssumptions,
      elementSummary,
      weightMismatches,
    },
  };
}

// ── Legacy flat-header parser (fallback) ────────────────────────

function parseFlatXlsx(data: any[], ws: XLSX.WorkSheet): ParseResult {
  if (data.length === 0) return { items: [], diagnostics: { detectedUnit: "mm", unitAssumed: true, rowCount: 0, missingSizes: [], formulaFallbacks: 0, excelTotalWeight: null, computedTotalKg: 0, mismatchPct: null, assumptions: [], elementSummary: {}, weightMismatches: 0 } };

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

    let qty = parseNumericValue(qtyKey ? row[qtyKey] : 1);
    if (qty <= 0) qty = 1;

    let multiplier = 1;
    if (multiplierKey && row[multiplierKey] !== undefined) {
      multiplier = parseNumericValue(row[multiplierKey]);
      if (multiplier <= 0) multiplier = 1;
    }

    let rawLength = lengthKey ? row[lengthKey] : 0;
    if (typeof rawLength === "string" && rawLength.trim().startsWith("=")) {
      formulaFallbacks++;
      assumptions.push("Formula could not be evaluated");
      rawLength = 0;
    }
    const lengthValue = parseNumericValue(rawLength);
    const length_mm = toMm(lengthValue, detectedUnit);

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
      elementSummary: {},
      weightMismatches: 0,
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

        // Try complex parser first, fall back to flat-header parser
        let result = tryParseComplexXlsx(ws);
        if (!result) {
          const raw = XLSX.utils.sheet_to_json(ws);
          if (!raw.length) { toast.error("No data found in the file"); return; }
          result = parseFlatXlsx(raw, ws);
        }

        const { items, diagnostics } = result;
        if (items.length === 0) { toast.error("No bar items found in the file"); return; }

        setBarList(items);
        onImport?.(items);

        // Build warnings
        const warnings: string[] = [];
        if (diagnostics.unitAssumed) warnings.push(`⚠ Length unit assumed: ${diagnostics.detectedUnit}`);
        if (diagnostics.missingSizes.length > 0) warnings.push(`⚠ Unknown sizes: ${diagnostics.missingSizes.join(", ")}`);
        if (diagnostics.formulaFallbacks > 0) warnings.push(`⚠ ${diagnostics.formulaFallbacks} formula(s) could not be evaluated`);
        if (diagnostics.weightMismatches > 0) warnings.push(`⚠ ${diagnostics.weightMismatches} row(s) with weight cross-check mismatch > 2%`);
        if (diagnostics.mismatchPct !== null && diagnostics.mismatchPct > 1) {
          warnings.push(`⚠ Weight mismatch: computed ${diagnostics.computedTotalKg.toFixed(1)} kg vs Excel total ${diagnostics.excelTotalWeight?.toFixed(1)} kg (${diagnostics.mismatchPct.toFixed(1)}% off)`);
        }
        // Element summary
        if (Object.keys(diagnostics.elementSummary).length > 0) {
          for (const [el, wt] of Object.entries(diagnostics.elementSummary)) {
            warnings.push(`📊 ${el}: ${(wt as number).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`);
          }
        }

        setImportWarnings(warnings);

        if (warnings.some(w => w.startsWith("⚠"))) {
          toast.warning(`Imported ${items.length} items with diagnostics`, {
            description: warnings.filter(w => w.startsWith("⚠")).join("\n"),
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
