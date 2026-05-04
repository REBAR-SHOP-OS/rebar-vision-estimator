export const detectDiscipline = (name: string): string | null => {
  const n = name.toUpperCase();
  if (/\bS[-_]?\d|STRUCTURAL|STR[-_]/i.test(n)) return "Structural";
  if (/\bA[-_]?\d|ARCHITECTURAL|ARCH[-_]/i.test(n)) return "Architectural";
  if (/\bC[-_]?\d|CIVIL/i.test(n)) return "Civil";
  if (/\bM[-_]?\d|MECHANICAL/i.test(n)) return "Mechanical";
  if (/\bE[-_]?\d|ELECTRICAL/i.test(n)) return "Electrical";
  if (/\bP[-_]?\d|PLUMBING/i.test(n)) return "Plumbing";
  if (/\bL[-_]?\d|LANDSCAPE/i.test(n)) return "Landscape";
  return null;
};

export const inferRebarFileKind = (fileName: string, mimeType: string | null): string => {
  const n = fileName.toLowerCase();

  if (/\.(xlsx|xls|csv)$/.test(n)) return "bar_list";
  if (/spec|specification/.test(n)) return "spec_pdf";
  if (/addendum|addenda|bulletin/.test(n)) return "addendum_pdf";

  if (/\.pdf$/.test(n) || (mimeType || "").includes("pdf")) {
    const discipline = detectDiscipline(fileName);
    if (discipline === "Structural") return "structural_pdf";
    if (discipline === "Architectural") return "architectural_pdf";
    return "other";
  }

  return "other";
};

export async function ensureRebarProjectBridge(
  supabase: any,
  legacyProjectId: string,
  projectName: string,
  customerName?: string | null,
) {
  const { data, error } = await supabase.rpc("ensure_rebar_project_bridge", {
    p_legacy_project_id: legacyProjectId,
    p_project_name: projectName,
    p_customer_name: customerName ?? null,
  });

  if (error) throw error;
  return data as string;
}

export async function ensureCurrentProjectRebarBridge(supabase: any, legacyProjectId: string) {
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, client_name")
    .eq("id", legacyProjectId)
    .single();

  if (error || !project) throw error || new Error("Project not found");

  return ensureRebarProjectBridge(
    supabase,
    project.id,
    project.name,
    (project as any).client_name || null,
  );
}

export async function ensureRebarProjectFileBridge(
  supabase: any,
  params: {
    legacyFileId: string;
    legacyProjectId: string;
    storagePath: string;
    originalFilename: string;
    fileKind: string;
    revisionLabel?: string | null;
    checksumSha256?: string | null;
    pageCount?: number | null;
  },
) {
  const { data, error } = await supabase.rpc("ensure_rebar_project_file_bridge", {
    p_legacy_file_id: params.legacyFileId,
    p_legacy_project_id: params.legacyProjectId,
    p_storage_path: params.storagePath,
    p_original_filename: params.originalFilename,
    p_file_kind: params.fileKind,
    p_revision_label: params.revisionLabel ?? null,
    p_checksum_sha256: params.checksumSha256 ?? null,
    p_page_count: params.pageCount ?? null,
  });

  if (error) throw error;
  return data as string;
}
