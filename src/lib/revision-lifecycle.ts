/**
 * Revision lifecycle helpers — Phase A (file + estimate).
 *
 * Pure functions live in revision-lifecycle-helpers.ts (no Supabase dependency).
 * This file contains the Supabase-integrated lifecycle operations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  findCurrentEstimateVersionId,
  findSupersedableRegistryRow,
} from "@/lib/revision-lifecycle-helpers";

// Re-export pure helpers so callers can use a single import path if desired
export { findSupersedableRegistryRow, findCurrentEstimateVersionId } from "@/lib/revision-lifecycle-helpers";

/**
 * Archive (supersede) the currently active document_registry row for the given
 * classification/discipline bucket, then record the new file's row as
 * superseding it.
 *
 * Returns the old registry row id that was archived, or null when no
 * supersession was needed.
 */
export async function supersedePreviousActiveFile(
  supabase: SupabaseClient<Database>,
  params: {
    projectId: string;
    userId: string;
    newFileId: string;
    classification: string;
    detectedDiscipline: string | null;
  },
): Promise<string | null> {
  // 1. Load active registry rows for this project, excluding the new file
  const { data: registryRows } = await (supabase as any)
    .from("document_registry")
    .select("id, file_id, classification, detected_discipline, is_active")
    .eq("project_id", params.projectId)
    .eq("is_active", true)
    .neq("file_id", params.newFileId);

  if (!registryRows || registryRows.length === 0) return null;

  const toSupersede = findSupersedableRegistryRow(
    registryRows,
    params.classification,
    params.detectedDiscipline,
  );
  if (!toSupersede) return null;

  // 2. Mark the old row inactive
  await (supabase as any)
    .from("document_registry")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", toSupersede.id);

  // 3. Record supersession link on the new row
  await (supabase as any)
    .from("document_registry")
    .update({ supersedes_file_id: toSupersede.file_id, updated_at: new Date().toISOString() })
    .eq("project_id", params.projectId)
    .eq("file_id", params.newFileId);

  // 4. Audit log
  await logAuditEvent(
    params.userId,
    "file_revision_superseded",
    "document_registry",
    toSupersede.id,
    params.projectId,
    undefined,
    { superseded_file_id: toSupersede.file_id, new_file_id: params.newFileId },
  );
  await logAuditEvent(
    params.userId,
    "file_revision_promoted",
    "document_registry",
    params.newFileId,
    params.projectId,
    undefined,
    { supersedes_file_id: toSupersede.file_id },
  );

  return toSupersede.id;
}

/**
 * Promote a newly created public.estimate_versions row to "current" and
 * archive any previous current version for the same project.
 *
 * @param newEstimateVersionId  The ID of the just-inserted estimate_versions row.
 */
export async function promotePublicEstimateVersion(
  supabase: SupabaseClient<Database>,
  params: {
    projectId: string;
    userId: string;
    newEstimateVersionId: string;
  },
): Promise<void> {
  // 1. Find the previous current version
  const { data: prevRows } = await supabase
    .from("estimate_versions")
    .select("id, is_current, version_number")
    .eq("project_id", params.projectId)
    .neq("id", params.newEstimateVersionId);

  const prevId = findCurrentEstimateVersionId(prevRows ?? []);

  // 2. Archive previous current row before promoting to satisfy the unique current index
  if (prevId) {
    await supabase
      .from("estimate_versions")
      .update({
        is_current: false,
        superseded_by_estimate_version_id: params.newEstimateVersionId,
        superseded_at: new Date().toISOString(),
      } as any)
      .eq("id", prevId);

    await logAuditEvent(
      params.userId,
      "estimate_version_superseded",
      "estimate_versions",
      prevId,
      params.projectId,
      undefined,
      { new_version_id: params.newEstimateVersionId },
    );
  }

  // 3. Mark new row as current
  await supabase
    .from("estimate_versions")
    .update({ is_current: true } as any)
    .eq("id", params.newEstimateVersionId);

  await logAuditEvent(
    params.userId,
    "estimate_version_promoted",
    "estimate_versions",
    params.newEstimateVersionId,
    params.projectId,
    undefined,
    { previous_version_id: prevId },
  );
}

/**
 * Promote a newly created rebar.estimate_versions row to "current" and
 * archive the previous current version for the same rebar project.
 *
 * @param newEstimateVersionId  The ID of the just-inserted rebar.estimate_versions row.
 */
export async function promoteRebarEstimateVersion(
  supabase: SupabaseClient<Database>,
  params: {
    rebarProjectId: string;
    userId: string;
    newEstimateVersionId: string;
  },
): Promise<void> {
  const sb = supabase as any;

  // 1. Find previous current version
  const { data: prevRows } = await sb
    .schema("rebar")
    .from("estimate_versions")
    .select("id, is_current, version_number")
    .eq("project_id", params.rebarProjectId)
    .neq("id", params.newEstimateVersionId);

  const prevId = findCurrentEstimateVersionId(prevRows ?? []);

  // 2. Archive previous before promoting to satisfy the unique current index
  if (prevId) {
    await sb
      .schema("rebar")
      .from("estimate_versions")
      .update({
        is_current: false,
        superseded_by_estimate_version_id: params.newEstimateVersionId,
        superseded_at: new Date().toISOString(),
      })
      .eq("id", prevId);

    await logAuditEvent(
      params.userId,
      "estimate_version_superseded",
      "rebar.estimate_versions",
      prevId,
      params.rebarProjectId,
      undefined,
      { new_version_id: params.newEstimateVersionId },
    );
  }

  // 3. Mark new row as current
  await sb
    .schema("rebar")
    .from("estimate_versions")
    .update({ is_current: true })
    .eq("id", params.newEstimateVersionId);

  await logAuditEvent(
    params.userId,
    "estimate_version_promoted",
    "rebar.estimate_versions",
    params.newEstimateVersionId,
    params.rebarProjectId,
    undefined,
    { previous_version_id: prevId },
  );
}
