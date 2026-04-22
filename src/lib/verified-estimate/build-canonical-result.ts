import { getMassKgPerM, getWwmMassKgPerM2 } from "@/lib/rebar-weights";
import type { CanonicalEstimateLine, CanonicalEstimateResultV1 } from "./canonical-types";

export interface WorkspaceBarRow {
  id: string;
  segment_id: string;
  mark: string | null;
  shape_code: string | null;
  cut_length: number | null;
  quantity: number | null;
  size: string | null;
  finish_type: string | null;
  confidence: number | null;
}

export interface WorkspaceEstimateItemRow {
  id?: string;
  segment_id: string;
  description: string | null;
  bar_size: string | null;
  quantity_count: number | null;
  total_length: number | null;
  total_weight: number | null;
  confidence: number | null;
  source_file_id: string | null;
  item_type?: string | null;
}

export interface SegmentRow {
  id: string;
  name: string;
  segment_type: string;
}

export interface FileRow {
  id: string;
  file_name: string | null;
}

export interface SheetIndexRow {
  document_version_id: string;
  page_number: number;
  sheet_number: string | null;
}

/** Map segment_id -> ordered list of linked source file ids */
export type SegmentSourceMap = Map<string, string[]>;

/** document_version_id -> file_id */
export type DocVersionToFileMap = Map<string, string>;

function lineWeightKg(size: string, qty: number, lengthMm: number): number {
  const isWwm = /\d.*x.*\d.*W/i.test(size) || getWwmMassKgPerM2(size) > 0;
  if (isWwm) {
    const sheetAreaM2 = 1.52 * 3.05;
    const massPerM2 = getWwmMassKgPerM2(size);
    return massPerM2 > 0 ? qty * sheetAreaM2 * massPerM2 : 0;
  }
  return qty * (lengthMm / 1000) * getMassKgPerM(size);
}

function resolveSheetLabel(
  sourceFileId: string | null,
  docVersionToFile: DocVersionToFileMap,
  sheets: SheetIndexRow[],
  fileName?: string | null,
): string | null {
  if (!sourceFileId) return null;
  const dvs = [...docVersionToFile.entries()].filter(([, fid]) => fid === sourceFileId).map(([dv]) => dv);
  const forDv = dvs.length > 0 ? sheets.filter((s) => dvs.includes(s.document_version_id)) : [];
  if (forDv.length > 0) {
    forDv.sort((a, b) => a.page_number - b.page_number);
    const first = forDv[0];
    return first.sheet_number || `p${first.page_number}`;
  }
  // Fallback: file-level reference so provenance is non-null
  return fileName ? `${fileName} (p1)` : "p1";
}

/**
 * Build deterministic canonical snapshot from workspace DB rows (bar_items + optional estimate_items).
 */
export function buildCanonicalResultFromWorkspace(input: {
  segments: SegmentRow[];
  barItems: WorkspaceBarRow[];
  estimateItems: WorkspaceEstimateItemRow[];
  files: FileRow[];
  segmentSources: SegmentSourceMap;
  docVersionToFile: DocVersionToFileMap;
  documentSheets: SheetIndexRow[];
}): CanonicalEstimateResultV1 {
  const segMap = new Map(input.segments.map((s) => [s.id, s]));
  const filesById = new Map(input.files.map((f) => [f.id, f]));

  const lines: CanonicalEstimateLine[] = [];
  const barList: Record<string, unknown>[] = [];

  const sortedBars = [...input.barItems].sort((a, b) => {
    const sa = a.segment_id.localeCompare(b.segment_id);
    if (sa !== 0) return sa;
    const ma = (a.mark || "").localeCompare(b.mark || "");
    if (ma !== 0) return ma;
    return a.id.localeCompare(b.id);
  });

  let idx = 0;
  for (const b of sortedBars) {
    const seg = segMap.get(b.segment_id);
    const size = b.size || "";
    const qty = b.quantity || 0;
    const lengthMm = b.cut_length || 0;
    const wt = lineWeightKg(size, qty, lengthMm);
    const srcList = input.segmentSources.get(b.segment_id) || [];
    const source_file_id = srcList[0] || null;
    const source_file_name = source_file_id ? filesById.get(source_file_id)?.file_name || null : null;
    const source_sheet = resolveSheetLabel(source_file_id, input.docVersionToFile, input.documentSheets);
    const extraction_method = "workspace_bar_item";
    const confidence = b.confidence != null ? Number(b.confidence) : 0.75;
    const review_required = !source_file_id || !source_sheet;

    const line_key = `${b.segment_id}|bar|${b.id}`;
    lines.push({
      line_key,
      description: b.mark || seg?.name || "Bar",
      size,
      qty,
      multiplier: 1,
      length_mm: lengthMm,
      weight_kg: wt,
      unit: "kg",
      bar_mark: b.mark || undefined,
      shape_code: b.shape_code || undefined,
      element_type: (seg?.segment_type || "OTHER").toUpperCase(),
      segment_id: b.segment_id,
      source_file_id,
      source_file_name,
      source_sheet,
      source_region: null,
      extraction_method,
      confidence,
      validation_status: review_required ? "pending" : "ok",
      review_required,
    });

    barList.push({
      element_id: seg?.name || "",
      element_type: (seg?.segment_type || "OTHER").toUpperCase(),
      bar_mark: b.mark || "",
      size,
      shape_code: b.shape_code || "straight",
      qty,
      multiplier: 1,
      length_mm: lengthMm,
      weight_kg: wt,
    });
    idx++;
  }

  if (sortedBars.length === 0 && input.estimateItems.length > 0) {
    const sortedEi = [...input.estimateItems].sort((a, b) =>
      `${a.segment_id}|${a.description}`.localeCompare(`${b.segment_id}|${b.description}`),
    );
    for (const ei of sortedEi) {
      if (ei.item_type === "source_link") continue;
      const seg = segMap.get(ei.segment_id);
      const wt = Number(ei.total_weight) || 0;
      const source_file_id = ei.source_file_id;
      const source_file_name = source_file_id ? filesById.get(source_file_id)?.file_name || null : null;
      const source_sheet = resolveSheetLabel(source_file_id, input.docVersionToFile, input.documentSheets);
      const review_required = !source_file_id || !source_sheet;
      const line_key = `${ei.segment_id}|ei|${ei.id || ei.description || "row"}|${idx++}`;
      lines.push({
        line_key,
        description: ei.description || ei.bar_size || "Item",
        size: ei.bar_size || "",
        qty: ei.quantity_count || 0,
        multiplier: 1,
        length_mm: (ei.total_length || 0) * (ei.bar_size?.match(/wwm|mesh/i) ? 1 : 1000),
        weight_kg: wt,
        unit: "kg",
        element_type: (seg?.segment_type || "OTHER").toUpperCase(),
        segment_id: ei.segment_id,
        source_file_id,
        source_file_name,
        source_sheet,
        source_region: null,
        extraction_method: "workspace_estimate_item",
        confidence: ei.confidence != null ? Number(ei.confidence) : 0.6,
        validation_status: review_required ? "pending" : "ok",
        review_required,
      });
      barList.push({
        element_type: (seg?.segment_type || "OTHER").toUpperCase(),
        size: ei.bar_size || "",
        qty: ei.quantity_count || 0,
        multiplier: 1,
        length_mm: 0,
        weight_kg: wt,
        description: ei.description || "",
      });
    }
  }

  const size_breakdown_kg: Record<string, number> = {};
  for (const line of lines) {
    if (line.review_required) continue;
    const sz = line.size || "unknown";
    size_breakdown_kg[sz] = (size_breakdown_kg[sz] || 0) + line.weight_kg;
  }
  const total_weight_kg = Object.values(size_breakdown_kg).reduce((a, b) => a + b, 0);

  return {
    schema_version: 1,
    lines,
    quote: {
      bar_list: barList,
      size_breakdown_kg,
      total_weight_kg,
      total_weight_lbs: total_weight_kg / 0.453592,
    },
    inputs_summary: {
      file_ids: [...new Set(input.files.map((f) => f.id))],
      document_version_ids: [...input.docVersionToFile.keys()],
    },
  };
}

/**
 * Map chat/LLM elements + synthetic quote into canonical shape (weak provenance → review_required).
 */
export function buildCanonicalResultFromChatQuote(input: {
  elements: unknown[];
  quote: {
    bar_list?: Record<string, unknown>[];
    size_breakdown_kg?: Record<string, number>;
    total_weight_kg?: number;
    job_status?: string;
    reconciliation?: Record<string, unknown>;
    risk_flags?: unknown[];
  };
  usedFallbackJson?: boolean;
}): CanonicalEstimateResultV1 {
  const barList = input.quote.bar_list || [];
  const lines: CanonicalEstimateLine[] = [];

  const sorted = [...barList].sort((a, b) => stableKey(a).localeCompare(stableKey(b)));

  sorted.forEach((raw, i) => {
    const r = raw as Record<string, unknown>;
    const size = String(r.size || "");
    const qty = Number(r.qty || 0);
    const lengthMm = Number(r.length_mm || 0);
    const weight_kg = Number(r.weight_kg != null ? r.weight_kg : lineWeightKg(size, qty, lengthMm));
    const extraction_method = input.usedFallbackJson
      ? "llm_fallback_json"
      : String(r.extraction_method || "llm_structured");
    const source_file_id = (r.source_file_id as string) || null;
    const source_sheet = (r.source_sheet as string) || null;
    const review_required =
      !source_file_id ||
      !source_sheet ||
      extraction_method === "llm_fallback_json" ||
      extraction_method === "ocr_full_page";

    lines.push({
      line_key: `chat|${i}|${String(r.element_id || r.bar_mark || i)}`,
      description: String(r.sub_element || r.description || r.bar_mark || "Line"),
      size,
      qty,
      multiplier: Number(r.multiplier || 1),
      length_mm: lengthMm,
      weight_kg,
      unit: "kg",
      bar_mark: r.bar_mark != null ? String(r.bar_mark) : undefined,
      shape_code: r.shape_code != null ? String(r.shape_code) : undefined,
      element_type: String(r.element_type || "OTHER"),
      source_file_id,
      source_file_name: r.source_file_name != null ? String(r.source_file_name) : null,
      source_sheet,
      source_region: r.source_region != null ? String(r.source_region) : null,
      extraction_method,
      confidence: Number(r.confidence ?? 0.55),
      validation_status: review_required ? "pending" : "ok",
      review_required,
    });
  });

  const size_breakdown_kg = { ...input.quote.size_breakdown_kg };
  const total_weight_kg =
    input.quote.total_weight_kg ??
    Object.values(size_breakdown_kg).reduce((a, b) => a + b, 0);

  return {
    schema_version: 1,
    lines,
    quote: {
      bar_list: barList as Record<string, unknown>[],
      size_breakdown_kg,
      total_weight_kg,
      total_weight_lbs: total_weight_kg / 0.453592,
      reconciliation: input.quote.reconciliation,
      risk_flags: input.quote.risk_flags,
      job_status: input.quote.job_status,
    },
  };
}

function stableKey(r: Record<string, unknown>): string {
  return `${r.element_id || ""}|${r.bar_mark || ""}|${r.size || ""}`;
}
