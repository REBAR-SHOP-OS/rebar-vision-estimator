import { supabase } from "@/integrations/supabase/client";

/**
 * Inserts a row into audit_events.
 * Audit logging failures are reported to the console but do not block
 * the primary user action that triggered the audit event.
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
    console.error("[audit] logAuditEvent failed:", error.message);
  }
}
