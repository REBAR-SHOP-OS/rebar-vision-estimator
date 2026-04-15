import { supabase } from "@/integrations/supabase/client";

/**
 * Inserts a row into audit_events.
 * Errors are surfaced via the returned promise so callers can decide
 * whether to handle or ignore them — they are never silently swallowed.
 */
export async function logAuditEvent(
  userId: string,
  action: string,
  entityType: string,
  entityId?: string,
  projectId?: string,
  segmentId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from("audit_events").insert({
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    project_id: projectId ?? null,
    segment_id: segmentId ?? null,
    metadata: metadata ?? {},
  });
  if (error) {
    // Log to console so the error is visible in production logs,
    // then re-throw so callers can respond appropriately.
    console.error("[audit] logAuditEvent failed:", error.message);
    throw new Error(`Audit log failed: ${error.message}`);
  }
}
