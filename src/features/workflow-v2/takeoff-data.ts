/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";
import { getRebarProjectIdByLegacyId } from "@/lib/rebar-read-model";

export interface WorkflowFileRef {
  id: string;
  legacy_file_id?: string | null;
  file_name: string;
}

export interface WorkflowTakeoffRow {
  id: string;
  mark: string;
  size: string;
  shape: string;
  count: number;
  length: number;
  weight: number;
  status: "ready" | "review" | "blocked";
  source: string;
  // Newly added — minimal fields for segment grouping, blueprint preview & inline OCR edit
  segment_id: string | null;
  segment_name: string;
  source_file_id: string | null;
  raw_id: string;        // raw DB id (without legacy:/canonical: prefix)
  raw_kind: "legacy" | "canonical";
}

export interface WorkflowQaIssue {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  sheet_id?: string | null;
  issue_type: string;
}

const CLOSED_STATUSES = new Set(["resolved", "closed"]);

function isOpenStatus(status?: string | null) {
  return !CLOSED_STATUSES.has(String(status || "").toLowerCase());
}

function coercePayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function getCanonicalTakeoffRuns(legacyProjectId: string) {
  const rebarProjectId = await getRebarProjectIdByLegacyId(supabase, legacyProjectId).catch((error) => {
    console.warn("Failed to resolve canonical takeoff project:", error);
    return null;
  });
  if (!rebarProjectId) return [];

  const { data, error } = await (supabase as any)
    .schema("rebar")
    .from("takeoff_runs")
    .select("id,status,created_at,completed_at,source_revision_label,overall_confidence")
    .eq("project_id", rebarProjectId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Failed to load canonical takeoff runs:", error);
    return [];
  }
  return data || [];
}

async function loadLegacyTakeoffRows(projectId: string, files: WorkflowFileRef[]): Promise<WorkflowTakeoffRow[]> {
  const { data, error } = await supabase
    .from("estimate_items")
    .select("id, bar_size, description, quantity_count, total_length, total_weight, status, confidence, source_file_id, segment_id")
    .eq("project_id", projectId)
    .limit(500);

  if (error) {
    console.warn("Failed to load legacy takeoff rows:", error);
    return [];
  }

  // Resolve segment names in one shot
  const segIds = Array.from(new Set((data || []).map((r) => r.segment_id).filter(Boolean) as string[]));
  const segMap = new Map<string, string>();
  if (segIds.length) {
    const { data: segs } = await supabase.from("segments").select("id,name").in("id", segIds);
    (segs || []).forEach((s) => segMap.set(s.id, s.name));
  }

  // Pull real bar marks from bar_items where available
  const itemIds = (data || []).map((r) => r.id);
  const markMap = new Map<string, string>();
  if (itemIds.length) {
    const { data: bars } = await supabase
      .from("bar_items")
      .select("estimate_item_id, mark")
      .in("estimate_item_id", itemIds);
    (bars || []).forEach((b: any) => {
      if (b.estimate_item_id && b.mark && !markMap.has(b.estimate_item_id)) {
        markMap.set(b.estimate_item_id, String(b.mark));
      }
    });
  }

  return (data || []).map((row, index: number) => {
    const file = files.find((candidate) => candidate.legacy_file_id === row.source_file_id || candidate.id === row.source_file_id);
    const realMark = markMap.get(row.id);
    return {
      id: `legacy:${row.id}`,
      raw_id: row.id,
      raw_kind: "legacy" as const,
      mark: realMark || `M${String(index + 1).padStart(3, "0")}`,
      size: row.bar_size || "-",
      shape: (row.description || "Straight").slice(0, 40),
      count: row.quantity_count || 0,
      length: Number(row.total_length || 0),
      weight: Number(row.total_weight || 0),
      status: (row.status === "approved" ? "ready" : Number(row.confidence) < 0.6 ? "blocked" : "review") as WorkflowTakeoffRow["status"],
      source: file?.file_name || "Legacy estimate",
      segment_id: row.segment_id || null,
      segment_name: row.segment_id ? (segMap.get(row.segment_id) || "Unassigned") : "Unassigned",
      source_file_id: file?.id || row.source_file_id || null,
    };
  });
}

async function loadCanonicalTakeoffRows(projectId: string): Promise<WorkflowTakeoffRow[]> {
  const runs = await getCanonicalTakeoffRuns(projectId);
  const runIds = runs.map((run: any) => run.id);
  if (runIds.length === 0) return [];
  const runById = new Map(runs.map((run: any) => [run.id, run]));

  const { data, error } = await (supabase as any)
    .schema("rebar")
    .from("takeoff_items")
    .select("id,takeoff_run_id,element_type,shape_type,bar_size,quantity,total_length_m,total_weight_kg,confidence,source_text,drawing_reference,extraction_payload,created_at")
    .in("takeoff_run_id", runIds)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.warn("Failed to load canonical takeoff rows:", error);
    return [];
  }

  return (data || []).map((row: any, index: number) => {
    const run = runById.get(row.takeoff_run_id) as Record<string, unknown> | undefined;
    const payload = coercePayload(row.extraction_payload);
    const confidence = Number(row.confidence || 0);
    return {
      id: `canonical:${row.id}`,
      raw_id: row.id,
      raw_kind: "canonical" as const,
      mark: `T${String(index + 1).padStart(3, "0")}`,
      size: row.bar_size || "-",
      shape: String(row.source_text || `${row.element_type || "Element"} / ${row.shape_type || "straight"}`).slice(0, 40),
      count: Number(row.quantity || 0),
      length: Number(row.total_length_m || 0),
      weight: Number(row.total_weight_kg || 0),
      status: (run?.status === "ready_for_review" ? "ready" : confidence < 0.6 ? "blocked" : "review") as WorkflowTakeoffRow["status"],
      source: String(payload.source_file_name || row.drawing_reference || run?.source_revision_label || "Canonical takeoff"),
      segment_id: null,
      segment_name: String(row.element_type || "Canonical"),
      source_file_id: null,
    };
  });
}

export async function loadWorkflowTakeoffRows(projectId: string, files: WorkflowFileRef[]) {
  const [legacyRows, canonicalRows] = await Promise.all([
    loadLegacyTakeoffRows(projectId, files),
    loadCanonicalTakeoffRows(projectId),
  ]);
  return [...legacyRows, ...canonicalRows];
}

export async function getWorkflowTakeoffRowCount(projectId: string) {
  const legacyCountReq = supabase
    .from("estimate_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const canonicalRuns = await getCanonicalTakeoffRuns(projectId);
  const runIds = canonicalRuns.map((run: any) => run.id);
  const canonicalCountReq = runIds.length > 0
    ? (supabase as any).schema("rebar").from("takeoff_items").select("id", { count: "exact", head: true }).in("takeoff_run_id", runIds)
    : Promise.resolve({ count: 0, error: null });

  const [legacyCount, canonicalCount] = await Promise.all([legacyCountReq, canonicalCountReq]);
  if (legacyCount.error) console.warn("Failed to count legacy takeoff rows:", legacyCount.error);
  if (canonicalCount.error) console.warn("Failed to count canonical takeoff rows:", canonicalCount.error);

  return (legacyCount.count || 0) + (canonicalCount.count || 0);
}

async function loadCanonicalQaIssues(projectId: string): Promise<WorkflowQaIssue[]> {
  const runs = await getCanonicalTakeoffRuns(projectId);
  const runIds = runs.map((run: any) => run.id);
  if (runIds.length === 0) return [];

  const { data, error } = await (supabase as any)
    .schema("rebar")
    .from("takeoff_warnings")
    .select("id,takeoff_item_id,warning_code,severity,message,created_at")
    .in("takeoff_run_id", runIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Failed to load canonical QA warnings:", error);
    return [];
  }

  return (data || []).map((warning: any) => ({
    id: `canonical:${warning.id}`,
    title: String(warning.warning_code || "takeoff_warning").replace(/_/g, " "),
    description: warning.message || null,
    severity: warning.severity || "warning",
    status: "open",
    sheet_id: warning.takeoff_item_id || null,
    issue_type: "takeoff_warning",
  }));
}

export async function loadWorkflowQaIssues(projectId: string): Promise<WorkflowQaIssue[]> {
  const legacyReq = supabase
    .from("validation_issues")
    .select("id,title,description,severity,status,sheet_id,issue_type")
    .eq("project_id", projectId)
    .order("severity", { ascending: true });

  const [legacyRes, canonicalIssues] = await Promise.all([legacyReq, loadCanonicalQaIssues(projectId)]);
  if (legacyRes.error) console.warn("Failed to load legacy QA issues:", legacyRes.error);

  const legacyIssues = ((legacyRes.data || []) as WorkflowQaIssue[])
    .filter((issue) => isOpenStatus(issue.status))
    .map((issue) => ({ ...issue, id: `legacy:${issue.id}` }));

  return [...legacyIssues, ...canonicalIssues];
}

export async function getWorkflowQaCounts(projectId: string) {
  const issues = await loadWorkflowQaIssues(projectId);
  return {
    open: issues.length,
    critical: issues.filter((issue) => ["critical", "error"].includes(issue.severity?.toLowerCase())).length,
  };
}

export async function getWorkflowEstimatorSignoff(projectId: string) {
  const { data, error } = await supabase
    .from("approvals")
    .select("id")
    .eq("project_id", projectId)
    .is("segment_id", null)
    .eq("approval_type", "estimator_signoff")
    .eq("status", "approved")
    .limit(1);

  if (error) {
    console.warn("Failed to load estimator signoff:", error);
    return false;
  }
  return (data || []).length > 0;
}

export async function saveWorkflowEstimatorSignoff(projectId: string, userId: string) {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("approvals")
    .select("id")
    .eq("project_id", projectId)
    .is("segment_id", null)
    .eq("approval_type", "estimator_signoff")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return supabase
      .from("approvals")
      .update({ status: "approved", resolved_at: now, notes: "Estimator signoff recorded in V2 workflow." })
      .eq("id", existing.id);
  }

  return supabase.from("approvals").insert({
    project_id: projectId,
    segment_id: null,
    user_id: userId,
    approval_type: "estimator_signoff",
    status: "approved",
    reviewer_name: "Estimator",
    notes: "Estimator signoff recorded in V2 workflow.",
    resolved_at: now,
  });
}

export async function clearWorkflowEstimatorSignoff(projectId: string) {
  return supabase
    .from("approvals")
    .update({ status: "pending", resolved_at: null, notes: "Returned to QA from V2 workflow." })
    .eq("project_id", projectId)
    .is("segment_id", null)
    .eq("approval_type", "estimator_signoff");
}
