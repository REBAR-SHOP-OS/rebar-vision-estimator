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

  if (/\.pdf$/.test(n) || (mimeType || "").includes("pdf")) {
    if (/(^|[^a-z0-9])(specs?|specifications?)([^a-z0-9]|$)/.test(n)) return "spec_pdf";
    if (/(^|[^a-z0-9])(addendum|addenda|bulletins?)([^a-z0-9]|$)/.test(n)) return "addendum_pdf";
    const discipline = detectDiscipline(fileName);
    if (discipline === "Structural") return "structural_pdf";
    if (discipline === "Architectural") return "architectural_pdf";
    return "other";
  }

  return "other";
};

function formatBridgeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

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

type CreateProjectWithCanonicalBridgeParams = {
  customerName?: string | null;
  normalizedName: string;
  projectName: string;
  userId: string;
};

type CreateProjectFileWithCanonicalBridgeParams = {
  checksumSha256?: string | null;
  fileKind: string;
  fileName: string;
  filePath: string;
  fileSize?: number | null;
  fileType?: string | null;
  pageCount?: number | null;
  projectId: string;
  revisionLabel?: string | null;
  userId: string;
};

export async function cleanupLegacyProjectUpload(
  supabase: any,
  params: {
    legacyFileId?: string | null;
    legacyProjectId?: string | null;
    storagePath?: string | null;
  },
) {
  const cleanupTasks: Promise<unknown>[] = [];

  if (params.legacyFileId) {
    cleanupTasks.push(supabase.from("project_files").delete().eq("id", params.legacyFileId));
  }

  if (params.storagePath) {
    cleanupTasks.push(supabase.storage.from("blueprints").remove([params.storagePath]));
  }

  if (params.legacyProjectId) {
    cleanupTasks.push(supabase.from("projects").delete().eq("id", params.legacyProjectId));
  }

  await Promise.allSettled(cleanupTasks);
}

export async function createProjectWithCanonicalBridge(
  supabase: any,
  params: CreateProjectWithCanonicalBridgeParams,
) {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: params.userId,
      name: params.projectName,
      normalized_name: params.normalizedName,
      workflow_status: "intake",
    })
    .select()
    .single();

  if (error || !data) throw error || new Error("Failed to create project");

  try {
    await ensureRebarProjectBridge(
      supabase,
      data.id,
      params.projectName,
      params.customerName ?? null,
    );

    return {
      ...data,
      canonicalBridgeHealthy: true,
    };
  } catch (bridgeError) {
    console.warn("Canonical project bridge sync failed, continuing with legacy project:", bridgeError);

    return {
      ...data,
      canonicalBridgeHealthy: false,
      canonicalBridgeError: formatBridgeError(bridgeError),
    };
  }
}

export async function createProjectFileWithCanonicalBridge(
  supabase: any,
  params: CreateProjectFileWithCanonicalBridgeParams,
) {
  let legacyFileId: string | null = null;

  try {
    const { data, error } = await supabase
      .from("project_files")
      .insert({
        project_id: params.projectId,
        user_id: params.userId,
        file_name: params.fileName,
        file_path: params.filePath,
        file_type: params.fileType ?? null,
        file_size: params.fileSize ?? null,
      })
      .select("id")
      .single();

    if (error || !data) throw error || new Error("Failed to save project file");

    legacyFileId = data.id;

    try {
      await ensureRebarProjectFileBridge(supabase, {
        legacyFileId: data.id,
        legacyProjectId: params.projectId,
        storagePath: params.filePath,
        originalFilename: params.fileName,
        fileKind: params.fileKind,
        revisionLabel: params.revisionLabel ?? null,
        checksumSha256: params.checksumSha256 ?? null,
        pageCount: params.pageCount ?? null,
      });

      return {
        ...data,
        canonicalBridgeHealthy: true,
      };
    } catch (bridgeError) {
      console.warn("Canonical project file bridge sync failed, continuing with legacy file:", bridgeError);

      return {
        ...data,
        canonicalBridgeHealthy: false,
        canonicalBridgeError: formatBridgeError(bridgeError),
      };
    }
  } catch (error) {
    await cleanupLegacyProjectUpload(supabase, {
      legacyFileId,
      storagePath: params.filePath,
    });
    throw error;
  }
}
