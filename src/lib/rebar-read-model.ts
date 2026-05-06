import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const fromAny = (supabase: SupabaseClient<Database>, table: string) =>
  (supabase as any).from(table);

export type CanonicalProjectView = {
  legacyProjectId: string;
  rebarProjectId: string;
  projectName: string;
  customerName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  projectNumber: string | null;
  location: string | null;
  tenderDueAt: string | null;
  concreteGrade: string | null;
  rebarGrade: string | null;
  bidNotes: string | null;
};

export type CanonicalProjectFileView = {
  legacyFileId: string | null;
  rebarProjectFileId: string;
  originalFilename: string;
  fileKind: string;
  revisionLabel: string | null;
  storagePath: string;
  pageCount: number | null;
  uploadedAt: string;
  sheetCount: number;
  parsedStatus: "pending" | "parsed";
  detectedDisciplines: string[];
  detectedSheetNumbers: string[];
};

export type CanonicalProjectSummary = {
  fileCount: number;
  sheetCount: number;
  takeoffRunCount: number;
  estimateVersionCount: number;
  warningCount: number;
};

function mapProjectRow(legacyProjectId: string, row: any): CanonicalProjectView {
  return {
    legacyProjectId,
    rebarProjectId: row.id,
    projectName: row.project_name,
    customerName: row.customer_name || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectNumber: row.project_number || null,
    location: row.location || null,
    tenderDueAt: row.tender_due_at || null,
    concreteGrade: row.concrete_grade || null,
    rebarGrade: row.rebar_grade || null,
    bidNotes: row.bid_notes || null,
  };
}

export async function getRebarProjectIdByLegacyId(
  supabase: SupabaseClient<Database>,
  legacyProjectId: string,
): Promise<string | null> {
  const { data: link, error } = await fromAny(supabase, "rebar_project_links")
    .select("rebar_project_id")
    .eq("legacy_project_id", legacyProjectId)
    .maybeSingle();

  if (error) throw error;
  return link?.rebar_project_id || null;
}

async function listRebarProjectFileIds(
  supabase: SupabaseClient<Database>,
  rebarProjectId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .schema("rebar")
    .from("project_files")
    .select("id")
    .eq("project_id", rebarProjectId);

  if (error) throw error;
  return (data || []).map((file: any) => file.id);
}

export async function getCanonicalProjectByLegacyId(
  supabase: SupabaseClient<Database>,
  legacyProjectId: string,
): Promise<CanonicalProjectView | null> {
  const rebarProjectId = await getRebarProjectIdByLegacyId(supabase, legacyProjectId);
  if (!rebarProjectId) return null;

  const { data: project, error: projectError } = await supabase
    .schema("rebar")
    .from("projects")
    .select("id, project_name, customer_name, status, created_at, updated_at, project_number, location, tender_due_at, concrete_grade, rebar_grade, bid_notes")
    .eq("id", rebarProjectId)
    .maybeSingle();

  if (projectError) throw projectError;
  if (!project) return null;

  return mapProjectRow(legacyProjectId, project);
}

export async function getCanonicalProjectFiles(
  supabase: SupabaseClient<Database>,
  legacyProjectId: string,
): Promise<CanonicalProjectFileView[]> {
  const rebarProjectId = await getRebarProjectIdByLegacyId(supabase, legacyProjectId);
  if (!rebarProjectId) return [];

  const { data: files, error: filesError } = await supabase
    .schema("rebar")
    .from("project_files")
    .select("id, file_kind, storage_path, original_filename, revision_label, page_count, created_at")
    .eq("project_id", rebarProjectId)
    .order("created_at", { ascending: false });

  if (filesError) throw filesError;
  if (!files || files.length === 0) return [];

  const rebarFileIds = files.map((file: any) => file.id);
  const [linksRes, sheetsRes] = await Promise.all([
    fromAny(supabase, "rebar_project_file_links")
      .select("legacy_file_id, rebar_project_file_id")
      .in("rebar_project_file_id", rebarFileIds),
    supabase
      .schema("rebar")
      .from("drawing_sheets")
      .select("project_file_id, sheet_number, discipline")
      .in("project_file_id", rebarFileIds)
      .order("page_number", { ascending: true }),
  ]);

  if (linksRes.error) throw linksRes.error;
  if (sheetsRes.error) throw sheetsRes.error;

  const legacyFileIdByRebarId = new Map<string, string | null>();
  for (const link of linksRes.data || []) {
    legacyFileIdByRebarId.set(link.rebar_project_file_id, link.legacy_file_id || null);
  }

  const sheetsByFileId = new Map<string, any[]>();
  for (const sheet of sheetsRes.data || []) {
    const rows = sheetsByFileId.get(sheet.project_file_id) || [];
    rows.push(sheet);
    sheetsByFileId.set(sheet.project_file_id, rows);
  }

  return files.map((file: any) => {
    const sheets = sheetsByFileId.get(file.id) || [];
    const detectedDisciplines = Array.from(
      new Set(sheets.map((sheet: any) => sheet.discipline).filter(Boolean)),
    );
    const detectedSheetNumbers = Array.from(
      new Set(sheets.map((sheet: any) => sheet.sheet_number).filter(Boolean)),
    );

    return {
      legacyFileId: legacyFileIdByRebarId.get(file.id) || null,
      rebarProjectFileId: file.id,
      originalFilename: file.original_filename,
      fileKind: file.file_kind,
      revisionLabel: file.revision_label || null,
      storagePath: file.storage_path,
      pageCount: file.page_count || null,
      uploadedAt: file.created_at,
      sheetCount: sheets.length,
      parsedStatus: sheets.length > 0 || file.page_count ? "parsed" : "pending",
      detectedDisciplines,
      detectedSheetNumbers,
    };
  });
}

export async function getCanonicalProjectSummary(
  supabase: SupabaseClient<Database>,
  legacyProjectId: string,
): Promise<CanonicalProjectSummary | null> {
  const rebarProjectId = await getRebarProjectIdByLegacyId(supabase, legacyProjectId);
  if (!rebarProjectId) return null;

  const rebarFileIds = await listRebarProjectFileIds(supabase, rebarProjectId);

  const [filesRes, sheetsRes, estimateVersionsRes, takeoffRunsDataRes] = await Promise.all([
    supabase.schema("rebar").from("project_files").select("id", { count: "exact", head: true }).eq("project_id", rebarProjectId),
    rebarFileIds.length > 0
      ? supabase.schema("rebar").from("drawing_sheets").select("id", { count: "exact", head: true }).in("project_file_id", rebarFileIds)
      : Promise.resolve({ count: 0, error: null } as any),
    supabase.schema("rebar").from("estimate_versions").select("id", { count: "exact", head: true }).eq("project_id", rebarProjectId),
    supabase.schema("rebar").from("takeoff_runs").select("id").eq("project_id", rebarProjectId),
  ]);

  if (filesRes.error) throw filesRes.error;
  if (sheetsRes.error) throw sheetsRes.error;
  if (estimateVersionsRes.error) throw estimateVersionsRes.error;
  if (takeoffRunsDataRes.error) throw takeoffRunsDataRes.error;

  const takeoffRunIds = (takeoffRunsDataRes.data || []).map((run: any) => run.id);
  const warningsRes = takeoffRunIds.length > 0
    ? await supabase.schema("rebar").from("takeoff_warnings").select("id", { count: "exact", head: true }).in("takeoff_run_id", takeoffRunIds)
    : ({ count: 0, error: null } as any);

  if (warningsRes.error) throw warningsRes.error;

  return {
    fileCount: filesRes.count || 0,
    sheetCount: sheetsRes.count || 0,
    takeoffRunCount: takeoffRunIds.length,
    estimateVersionCount: estimateVersionsRes.count || 0,
    warningCount: warningsRes.count || 0,
  };
}
