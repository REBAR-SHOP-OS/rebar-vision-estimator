import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sha256HexOfJson } from "./canonical-hash";
import type { CanonicalEstimateResultV1 } from "./canonical-types";
import {
  buildCanonicalResultFromWorkspace,
  buildCanonicalResultFromChatQuote,
  type DocVersionToFileMap,
  type SegmentSourceMap,
  type SheetIndexRow,
} from "./build-canonical-result";
import { diffReferenceVsCanonical } from "./reference-diff";
import { evaluateExportGate, type ExportGateResult } from "./export-gate";
import { persistRebarTakeoffFromCanonical } from "@/lib/rebar-takeoff-persistence";
import { validateStage2Quote } from "./stage2-schema";

// Helper to bypass type checking for tables not yet in generated types
const fromAny = (supabase: SupabaseClient<Database>, table: string) =>
  (supabase as any).from(table);

export interface PersistVerifiedEstimateSuccess {
  ok: true;
  gate: ExportGateResult;
}

export interface PersistVerifiedEstimateFailure {
  ok: false;
  kind: "schema_validation_failed" | "persistence_failed";
  message: string;
  gate: ExportGateResult;
}

export type PersistVerifiedEstimateResult = PersistVerifiedEstimateSuccess | PersistVerifiedEstimateFailure;

export async function fetchWorkspaceCanonicalInputs(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<Parameters<typeof buildCanonicalResultFromWorkspace>[0]> {
  const [segRes, filesRes, dvRes, sheetsRes] = await Promise.all([
    supabase.from("segments").select("id, name, segment_type").eq("project_id", projectId),
    supabase.from("project_files").select("id, file_name").eq("project_id", projectId),
    supabase.from("document_versions").select("id, file_id").eq("project_id", projectId),
    fromAny(supabase, "document_sheets").select("document_version_id, page_number, sheet_number").eq("project_id", projectId),
  ]);

  const segments = segRes.data || [];
  const segIds = segments.map((s: any) => s.id);
  const files = filesRes.data || [];

  const linksRes =
    segIds.length > 0
      ? await supabase.from("segment_source_links").select("segment_id, file_id").in("segment_id", segIds)
      : { data: [] as { segment_id: string; file_id: string }[] };

  let barItems: Parameters<typeof buildCanonicalResultFromWorkspace>[0]["barItems"] = [];
  let estimateItems: Parameters<typeof buildCanonicalResultFromWorkspace>[0]["estimateItems"] = [];
  if (segIds.length > 0) {
    const [bi, ei] = await Promise.all([
      supabase.from("bar_items").select("id, segment_id, mark, shape_code, cut_length, quantity, size, finish_type, confidence").in("segment_id", segIds),
      supabase
        .from("estimate_items")
        .select("id, segment_id, description, bar_size, quantity_count, total_length, total_weight, confidence, source_file_id, item_type")
        .eq("project_id", projectId),
    ]);
    barItems = bi.data || [];
    estimateItems = ei.data || [];
  }

  const docVersionToFile: DocVersionToFileMap = new Map();
  for (const dv of dvRes.data || []) {
    if (dv.file_id) docVersionToFile.set(dv.id, dv.file_id);
  }

  const segmentSources: SegmentSourceMap = new Map();
  for (const s of segments) segmentSources.set(s.id, []);
  for (const row of linksRes.data || []) {
    const arr = segmentSources.get(row.segment_id) || [];
    if (!arr.includes(row.file_id)) arr.push(row.file_id);
    segmentSources.set(row.segment_id, arr);
  }
  for (const s of segments) {
    if ((segmentSources.get(s.id) || []).length === 0 && files[0]) {
      segmentSources.set(s.id, [files[0].id]);
    }
  }

  const documentSheets: SheetIndexRow[] = ((sheetsRes as any).data || []).map((r: any) => ({
    document_version_id: r.document_version_id,
    page_number: r.page_number,
    sheet_number: r.sheet_number,
  }));

  return {
    segments,
    barItems,
    estimateItems,
    files,
    segmentSources,
    docVersionToFile,
    documentSheets,
  };
}

export async function saveVerifiedEstimateResult(
  supabase: SupabaseClient<Database>,
  params: {
    projectId: string;
    userId: string;
    result: CanonicalEstimateResultV1;
    status: "draft" | "verified" | "blocked";
    blockedReasons: string[];
  },
): Promise<{ id: string; content_hash: string }> {
  const content_hash = await sha256HexOfJson(params.result);
  const inputs_hash = await sha256HexOfJson(params.result.inputs_summary || {});

  await fromAny(supabase, "verified_estimate_results")
    .update({ is_current: false })
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId);

  const { count } = await fromAny(supabase, "verified_estimate_results")
    .select("id", { count: "exact", head: true })
    .eq("project_id", params.projectId);

  const version_number = (count || 0) + 1;

  const { data, error } = await fromAny(supabase, "verified_estimate_results")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      version_number,
      status: params.status,
      result_json: params.result,
      content_hash,
      inputs_hash,
      blocked_reasons: params.blockedReasons,
      is_current: true,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: data!.id, content_hash };
}

/** Refresh current verified snapshot from workspace rows + run gate + reference diff. */
export async function refreshVerifiedEstimateFromWorkspace(
  supabase: SupabaseClient<Database>,
  projectId: string,
  userId: string,
): Promise<{ result: CanonicalEstimateResultV1; gate: ReturnType<typeof evaluateExportGate>; id: string }> {
  const inputs = await fetchWorkspaceCanonicalInputs(supabase, projectId);
  const result = buildCanonicalResultFromWorkspace(inputs);

  const [issuesRes, refRes, rulesRes] = await Promise.all([
    supabase.from("validation_issues").select("severity, status, issue_type").eq("project_id", projectId),
    fromAny(supabase, "reference_answer_lines").select("normalized_key, mark, quantity, unit").eq("project_id", projectId),
    fromAny(supabase, "estimation_validation_rules").select("rule_type, payload, is_active").eq("user_id", userId),
  ]);

  const referenceDiff =
    refRes.data && refRes.data.length > 0
      ? diffReferenceVsCanonical(refRes.data as any[], result.lines)
      : null;

  const gate = evaluateExportGate({
    lines: result.lines,
    validationIssues: issuesRes.data || [],
    referenceDiff,
    rules: (rulesRes.data || []) as { rule_type: string; payload: Record<string, unknown>; is_active: boolean | null }[],
  });

  const status = gate.canExport ? "verified" : "blocked";
  const { id } = await saveVerifiedEstimateResult(supabase, {
    projectId,
    userId,
    result: {
      ...result,
      quote: {
        ...result.quote,
        job_status: gate.canExport ? "OK" : "BLOCKED",
      },
    },
    status,
    blockedReasons: gate.blocked_reasons,
  });

  return { result, gate, id };
}

export async function getCurrentVerifiedEstimate(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<any | null> {
  const { data } = await fromAny(supabase, "verified_estimate_results")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Mark every line in the current canonical snapshot as committed (review_required = false),
 * recompute size_breakdown_kg / total_weight_kg, and save a new verified snapshot.
 * Returns the count of lines committed.
 */
export async function commitAllLinesForExport(
  supabase: SupabaseClient<Database>,
  projectId: string,
  userId: string,
): Promise<{ committed: number; gate: ExportGateResult }> {
  // Always rebuild from workspace first so we operate on the freshest snapshot.
  await refreshVerifiedEstimateFromWorkspace(supabase, projectId, userId);
  const current = await getCurrentVerifiedEstimate(supabase, projectId);
  if (!current) throw new Error("No canonical snapshot to commit.");

  const result = current.result_json as CanonicalEstimateResultV1;
  const lines = (result.lines || []).map((l) => ({
    ...l,
    review_required: false,
    validation_status: l.validation_status === "pending" ? "ok" : l.validation_status,
  }));

  const size_breakdown_kg: Record<string, number> = {};
  for (const line of lines) {
    const sz = line.size || "unknown";
    size_breakdown_kg[sz] = (size_breakdown_kg[sz] || 0) + (line.weight_kg || 0);
  }
  const total_weight_kg = Object.values(size_breakdown_kg).reduce((a, b) => a + b, 0);

  const committedResult: CanonicalEstimateResultV1 = {
    ...result,
    lines,
    quote: {
      ...result.quote,
      size_breakdown_kg,
      total_weight_kg,
      total_weight_lbs: total_weight_kg / 0.453592,
      job_status: "OK",
    },
  };

  // Re-run gate with committed lines (validation issues + reference diff still apply).
  const [issuesRes, refRes, rulesRes] = await Promise.all([
    supabase.from("validation_issues").select("severity, status, issue_type").eq("project_id", projectId),
    fromAny(supabase, "reference_answer_lines").select("normalized_key, mark, quantity, unit").eq("project_id", projectId),
    fromAny(supabase, "estimation_validation_rules").select("rule_type, payload, is_active").eq("user_id", userId),
  ]);
  const referenceDiff =
    refRes.data && refRes.data.length > 0
      ? diffReferenceVsCanonical(refRes.data as any[], committedResult.lines)
      : null;
  const gate = evaluateExportGate({
    lines: committedResult.lines,
    validationIssues: issuesRes.data || [],
    referenceDiff,
    rules: (rulesRes.data || []) as { rule_type: string; payload: Record<string, unknown>; is_active: boolean | null }[],
  });

  await saveVerifiedEstimateResult(supabase, {
    projectId,
    userId,
    result: committedResult,
    status: gate.canExport ? "verified" : "blocked",
    blockedReasons: gate.blocked_reasons,
  });

  return { committed: lines.length, gate };
}

/** Persist chat-derived quote as current verified snapshot and return export gate outcome. */
export async function persistVerifiedEstimateFromChat(
  supabase: SupabaseClient<Database>,
  params: {
    projectId: string;
    userId: string;
    elements: unknown[];
    quote: Record<string, unknown>;
    usedFallbackJson: boolean;
  },
): Promise<PersistVerifiedEstimateResult> {
  const parsedQuote = validateStage2Quote(params.quote);
  if ("error" in parsedQuote) {
    return {
      ok: false,
      kind: "schema_validation_failed",
      message: "Stage 2 output did not match the expected export schema.",
      gate: {
        canExport: false,
        blocked_reasons: parsedQuote.error.blockedReasons,
      },
    };
  }

  const result = buildCanonicalResultFromChatQuote({
    elements: params.elements,
    quote: parsedQuote.data,
    usedFallbackJson: params.usedFallbackJson,
  });

  const [issuesRes, refRes, rulesRes] = await Promise.all([
    supabase.from("validation_issues").select("severity, status, issue_type").eq("project_id", params.projectId),
    fromAny(supabase, "reference_answer_lines").select("normalized_key, mark, quantity, unit").eq("project_id", params.projectId),
    fromAny(supabase, "estimation_validation_rules").select("rule_type, payload, is_active").eq("user_id", params.userId),
  ]);

  const referenceDiff =
    refRes.data && refRes.data.length > 0
      ? diffReferenceVsCanonical(refRes.data as any[], result.lines)
      : null;

  const gate = evaluateExportGate({
    lines: result.lines,
    validationIssues: issuesRes.data || [],
    referenceDiff,
    rules: (rulesRes.data || []) as { rule_type: string; payload: Record<string, unknown>; is_active: boolean | null }[],
  });

  try {
    await saveVerifiedEstimateResult(supabase, {
      projectId: params.projectId,
      userId: params.userId,
      result,
      status: gate.canExport ? "verified" : "blocked",
      blockedReasons: gate.blocked_reasons,
    });
    await persistRebarTakeoffFromCanonical(supabase, {
      legacyProjectId: params.projectId,
      userId: params.userId,
      result,
      parserProvider: params.usedFallbackJson ? "gpt_fallback_json" : "gpt_structured",
    });
  } catch (e) {
    console.warn("[persistVerifiedEstimateFromChat] persistence unavailable:", e);
    return {
      ok: false,
      kind: "persistence_failed",
      message: e instanceof Error ? e.message : "Could not persist canonical snapshot.",
      gate,
    };
  }

  return { ok: true, gate };
}
