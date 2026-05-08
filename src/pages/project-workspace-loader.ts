import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getCanonicalProjectByLegacyId } from "@/lib/rebar-read-model";

type LegacyProjectRow = Database["public"]["Tables"]["projects"]["Row"];

export type WorkspaceProjectModel = LegacyProjectRow & {
  canonicalProject: Awaited<ReturnType<typeof getCanonicalProjectByLegacyId>>;
  project_name?: string | null;
  customer_name?: string | null;
  location?: string | null;
  rebar_project_id?: string | null;
};

async function loadLegacyProject(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<LegacyProjectRow | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    console.warn("Failed to load legacy project:", error);
  }

  return data ?? null;
}

async function resolveLegacyProjectId(
  supabase: SupabaseClient<Database>,
  routeId: string,
): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from("rebar_project_links")
    .select("legacy_project_id")
    .eq("rebar_project_id", routeId)
    .maybeSingle();

  if (error) {
    console.warn("Failed to resolve rebar project link:", error);
    return null;
  }

  return data?.legacy_project_id || null;
}

export async function loadWorkspaceProject(
  supabase: SupabaseClient<Database>,
  routeId: string,
): Promise<WorkspaceProjectModel | null> {
  let legacyProjectId = routeId;
  let legacyProject = await loadLegacyProject(supabase, legacyProjectId);

  if (!legacyProject) {
    const linkedLegacyId = await resolveLegacyProjectId(supabase, routeId);
    if (linkedLegacyId) {
      legacyProjectId = linkedLegacyId;
      legacyProject = await loadLegacyProject(supabase, linkedLegacyId);
    }
  }

  if (!legacyProject) return null;

  let canonicalProject = null;
  try {
    canonicalProject = await getCanonicalProjectByLegacyId(supabase, legacyProjectId);
  } catch (error) {
    console.warn("Failed to load canonical project:", error);
  }

  return {
    ...legacyProject,
    canonicalProject,
    project_name: canonicalProject?.projectName || legacyProject.name,
    customer_name: canonicalProject?.customerName ?? legacyProject.client_name,
    location: canonicalProject?.location ?? legacyProject.address ?? null,
    rebar_project_id: canonicalProject?.rebarProjectId || null,
    status: canonicalProject?.status || legacyProject.status,
  };
}
