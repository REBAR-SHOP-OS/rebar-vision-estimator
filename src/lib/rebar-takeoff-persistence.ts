import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CanonicalEstimateLine, CanonicalEstimateResultV1 } from "@/lib/verified-estimate/canonical-types";
import { getMassKgPerM } from "@/lib/rebar-weights";

const fromAny = (supabase: SupabaseClient<Database>, table: string) =>
  (supabase as any).from(table);

const ALLOWED_BAR_SIZES = new Set(["10M", "15M", "20M", "25M", "30M", "35M"]);
const ELEMENT_TYPES = new Set(["footing", "wall", "slab", "pier", "grade_beam", "column", "other"]);
const SHAPE_TYPES = new Set(["straight", "stirrup", "dowel", "hook", "bend", "other"]);

function mapElementType(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "beam" || normalized === "grade_beam") return "grade_beam";
  if (ELEMENT_TYPES.has(normalized)) return normalized;
  return "other";
}

function mapShapeType(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized.includes("stirrup") || normalized.includes("tie")) return "stirrup";
  if (normalized.includes("dowel")) return "dowel";
  if (normalized.includes("hook")) return "hook";
  if (normalized.includes("bend")) return "bend";
  if (SHAPE_TYPES.has(normalized)) return normalized;
  return "straight";
}

function inferMultiplier(line: CanonicalEstimateLine): number {
  return Number.isFinite(line.multiplier) && line.multiplier > 0 ? line.multiplier : 1;
}

function inferCutLengthM(line: CanonicalEstimateLine): number {
  const mm = Number(line.length_mm || 0);
  return mm > 0 ? mm / 1000 : 0;
}

function inferKgPerM(line: CanonicalEstimateLine): number {
  if (ALLOWED_BAR_SIZES.has(line.size)) return getMassKgPerM(line.size);
  const qty = Number(line.qty || 0);
  const mult = inferMultiplier(line);
  const cutLengthM = inferCutLengthM(line);
  if (qty > 0 && mult > 0 && cutLengthM > 0 && Number(line.weight_kg) > 0) {
    return Number(line.weight_kg) / (qty * mult * cutLengthM);
  }
  return 0;
}

async function findDrawingSheetId(
  supabase: SupabaseClient<Database>,
  sourceFileId: string | null,
  sourceSheet: string | null,
): Promise<string | null> {
  if (!sourceFileId) return null;

  const { data: fileLink } = await fromAny(supabase, "rebar_project_file_links")
    .select("rebar_project_file_id")
    .eq("legacy_file_id", sourceFileId)
    .maybeSingle();
  const rebarProjectFileId = fileLink?.rebar_project_file_id;
  if (!rebarProjectFileId) return null;

  let query = supabase.schema("rebar").from("drawing_sheets").select("id").eq("project_file_id", rebarProjectFileId);
  if (sourceSheet) {
    query = query.eq("sheet_number", sourceSheet);
  }

  const { data } = await query.limit(1).maybeSingle();
  if (data?.id) return data.id;

  const { data: fallback } = await supabase.schema("rebar").from("drawing_sheets").select("id").eq("project_file_id", rebarProjectFileId).order("page_number", { ascending: true }).limit(1).maybeSingle();
  return fallback?.id || null;
}

export async function persistRebarTakeoffFromCanonical(
  supabase: SupabaseClient<Database>,
  params: {
    legacyProjectId: string;
    userId: string;
    result: CanonicalEstimateResultV1;
    sourceRevisionLabel?: string | null;
    parserProvider?: string;
  },
) {
  const { data: projectLink } = await fromAny(supabase, "rebar_project_links")
    .select("rebar_project_id")
    .eq("legacy_project_id", params.legacyProjectId)
    .maybeSingle();

  const rebarProjectId = projectLink?.rebar_project_id;
  if (!rebarProjectId) {
    throw new Error("Missing rebar project bridge");
  }

  const validLines = params.result.lines.filter((line) => ALLOWED_BAR_SIZES.has(line.size));
  const unsupportedLines = params.result.lines.filter((line) => !ALLOWED_BAR_SIZES.has(line.size));
  const runWarnings = unsupportedLines.length > 0 || validLines.some((line) => line.review_required || line.confidence < 0.7);

  const { data: takeoffRun, error: runError } = await supabase.schema("rebar").from("takeoff_runs").insert({
    project_id: rebarProjectId,
    source_revision_label: params.sourceRevisionLabel ?? null,
    parser_provider: params.parserProvider || "gpt",
    ocr_provider: "google_vision",
    status: runWarnings ? "needs_attention" : "ready_for_review",
    overall_confidence:
      validLines.length > 0
        ? validLines.reduce((sum, line) => sum + Number(line.confidence || 0), 0) / validLines.length
        : null,
    missing_sheet_warning: validLines.some((line) => !line.source_sheet),
    unclear_scale_warning: false,
    not_found_warning: unsupportedLines.length > 0,
    requested_by: params.userId,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }).select("id").single();

  if (runError || !takeoffRun?.id) throw runError || new Error("Failed to create takeoff run");

  const lineToItemId = new Map<string, string>();
  for (const line of validLines) {
    const drawingSheetId = await findDrawingSheetId(supabase, line.source_file_id, line.source_sheet);
    const multiplier = inferMultiplier(line);
    const cutLengthM = inferCutLengthM(line);
    const kgPerM = inferKgPerM(line);

    const { data: item, error: itemError } = await supabase.schema("rebar").from("takeoff_items").insert({
      takeoff_run_id: takeoffRun.id,
      drawing_sheet_id: drawingSheetId,
      element_type: mapElementType(line.element_type),
      shape_type: mapShapeType(line.shape_code),
      bar_size: line.size,
      spacing_text: null,
      quantity: Number(line.qty || 0),
      multiplier,
      cut_length_m: cutLengthM,
      kg_per_m: kgPerM,
      drawing_reference: line.source_sheet,
      confidence: Number(line.confidence || 0),
      source_text: line.description,
      extraction_payload: {
        line_key: line.line_key,
        source_file_id: line.source_file_id,
        source_file_name: line.source_file_name,
        source_region: line.source_region,
        extraction_method: line.extraction_method,
        validation_status: line.validation_status,
        review_required: line.review_required,
      },
    }).select("id").single();

    if (!itemError && item?.id) {
      lineToItemId.set(line.line_key, item.id);
    }
  }

  const warningRows: Array<Record<string, unknown>> = [];
  for (const line of validLines) {
    const takeoffItemId = lineToItemId.get(line.line_key) || null;
    if (line.review_required) {
      warningRows.push({
        takeoff_run_id: takeoffRun.id,
        takeoff_item_id: takeoffItemId,
        warning_code: !line.source_sheet ? "missing_sheet" : "manual_override",
        severity: "warning",
        message: !line.source_sheet
          ? `Line ${line.description} is missing a drawing-sheet reference.`
          : `Line ${line.description} requires human review before approval.`,
      });
    }
    if (Number(line.confidence || 0) < 0.7) {
      warningRows.push({
        takeoff_run_id: takeoffRun.id,
        takeoff_item_id: takeoffItemId,
        warning_code: "low_confidence",
        severity: "warning",
        message: `Line ${line.description} has low confidence (${Math.round(Number(line.confidence || 0) * 100)}%).`,
      });
    }
  }

  for (const line of unsupportedLines) {
    warningRows.push({
      takeoff_run_id: takeoffRun.id,
      takeoff_item_id: null,
      warning_code: "not_found_on_drawings",
      severity: "warning",
      message: `Skipped unsupported bar size ${line.size || "unknown"} for line ${line.description}.`,
    });
  }

  if (warningRows.length > 0) {
    await supabase.schema("rebar").from("takeoff_warnings").insert(warningRows);
  }

  const assumptions = (params.result.quote.risk_flags || []) as unknown[];
  if (assumptions.length > 0) {
    await supabase.schema("rebar").from("takeoff_assumptions").insert(
      assumptions.map((flag, index) => ({
        takeoff_run_id: takeoffRun.id,
        assumption_text: String(flag),
        sort_order: index + 1,
      })),
    );
  }

  const { count } = await supabase.schema("rebar").from("estimate_versions").select("id", { count: "exact", head: true }).eq("project_id", rebarProjectId);
  const versionNumber = (count || 0) + 1;

  const { data: estimateVersion, error: estimateError } = await supabase.schema("rebar").from("estimate_versions").insert({
    project_id: rebarProjectId,
    takeoff_run_id: takeoffRun.id,
    version_number: versionNumber,
    quote_status: "draft",
    prepared_by: params.userId,
    subtotal_weight_kg: Number(params.result.quote.total_weight_kg || 0),
    total_weight_kg: Number(params.result.quote.total_weight_kg || 0),
    assumptions_snapshot: assumptions,
    exclusions_snapshot: [],
  }).select("id").single();

  if (estimateError) throw estimateError;

  return {
    takeoffRunId: takeoffRun.id,
    estimateVersionId: estimateVersion?.id || null,
  };
}
