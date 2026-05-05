import { supabase } from "@/integrations/supabase/client";

export async function logAuditEvent(
  userId: string,
  action: string,
  entityType: string,
  entityId?: string,
  projectId?: string,
  segmentId?: string,
  metadata?: Record<string, unknown>
) {
  const { error } = await supabase.from("audit_events").insert({
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId || undefined,
    project_id: projectId || undefined,
    segment_id: segmentId || undefined,
    metadata: metadata || {},
  });
  if (error) console.error("Audit log failed:", error.message);
}
