import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface RebarTakeoffOverview {
  runCount: number;
  latestRunId: string | null;
  latestStatus: string | null;
  latestConfidence: number | null;
  warningCount: number;
  itemCount: number;
  latestEstimateVersion: number | null;
}

export interface RebarTakeoffWarningRow {
  id: string;
  warning_code: string;
  severity: string;
  message: string;
  created_at: string;
  takeoff_item_id: string | null;
}

const fromAny = (supabase: SupabaseClient<Database>, table: string) =>
  (supabase as any).from(table);

export async function getRebarProjectId(
  supabase: SupabaseClient<Database>,
  legacyProjectId: string,
): Promise<string | null> {
  const { data } = await fromAny(supabase, "rebar_project_links")
    .select("rebar_project_id")
    .eq("legacy_project_id", legacyProjectId)
    .maybeSingle();
  return data?.rebar_project_id || null;
}

export async function fetchRebarTakeoffOverview(
  supabase: SupabaseClient<Database>,
  legacyProjectId: string,
): Promise<RebarTakeoffOverview | null> {
  const rebarProjectId = await getRebarProjectId(supabase, legacyProjectId);
  if (!rebarProjectId) return null;

  const [runsRes, estimatesRes] = await Promise.all([
    supabase
      .schema("rebar")
      .from("takeoff_runs")
      .select("id, status, overall_confidence, created_at")
      .eq("project_id", rebarProjectId)
      .order("created_at", { ascending: false }),
    supabase
      .schema("rebar")
      .from("estimate_versions")
      .select("version_number")
      .eq("project_id", rebarProjectId)
      .order("version_number", { ascending: false })
      .limit(1),
  ]);

  const runs = runsRes.data || [];
  if (runs.length === 0) {
    return {
      runCount: 0,
      latestRunId: null,
      latestStatus: null,
      latestConfidence: null,
      warningCount: 0,
      itemCount: 0,
      latestEstimateVersion: null,
    };
  }

  const latestRunId = runs[0].id;
  const [warningsRes, itemsRes] = await Promise.all([
    supabase.schema("rebar").from("takeoff_warnings").select("id", { count: "exact", head: true }).eq("takeoff_run_id", latestRunId),
    supabase.schema("rebar").from("takeoff_items").select("id", { count: "exact", head: true }).eq("takeoff_run_id", latestRunId),
  ]);

  return {
    runCount: runs.length,
    latestRunId,
    latestStatus: runs[0].status || null,
    latestConfidence: runs[0].overall_confidence != null ? Number(runs[0].overall_confidence) : null,
    warningCount: warningsRes.count || 0,
    itemCount: itemsRes.count || 0,
    latestEstimateVersion: estimatesRes.data?.[0]?.version_number ?? null,
  };
}

export async function fetchRebarTakeoffWarnings(
  supabase: SupabaseClient<Database>,
  legacyProjectId: string,
): Promise<RebarTakeoffWarningRow[]> {
  const rebarProjectId = await getRebarProjectId(supabase, legacyProjectId);
  if (!rebarProjectId) return [];

  const { data: latestRun } = await supabase
    .schema("rebar")
    .from("takeoff_runs")
    .select("id")
    .eq("project_id", rebarProjectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRun?.id) return [];

  const { data } = await supabase
    .schema("rebar")
    .from("takeoff_warnings")
    .select("id, warning_code, severity, message, created_at, takeoff_item_id")
    .eq("takeoff_run_id", latestRun.id)
    .order("created_at", { ascending: false });

  return (data || []) as RebarTakeoffWarningRow[];
}
