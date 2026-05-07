-- Bulk-accept synthetic dimensions for project cd42ebfe-18cc-48c3-b883-fc628c4593e3
WITH updated AS (
  UPDATE public.estimate_items e
  SET status = CASE WHEN e.status='unresolved' THEN 'draft' ELSE e.status END,
      assumptions_json = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
        COALESCE(e.assumptions_json,'{}'::jsonb),
        '{linear_geometry,lengthMm}', to_jsonb(COALESCE((e.assumptions_json->'linear_geometry'->>'lengthMm')::numeric, 10000)), true),
        '{linear_geometry,heightMm}', to_jsonb(COALESCE((e.assumptions_json->'linear_geometry'->>'heightMm')::numeric, 3000)), true),
        '{missing_refs}', '[]'::jsonb, true),
        '{geometry_status}', '"assumed_confirmed"'::jsonb, true),
        '{confirmation_source}', '"user_accept_synthetic_bulk"'::jsonb, true),
        '{confirmed_at}', to_jsonb(now()::text), true)
  WHERE e.project_id='cd42ebfe-18cc-48c3-b883-fc628c4593e3'
    AND (e.assumptions_json->>'missing_refs' <> '[]'
         OR e.assumptions_json->>'geometry_status' = 'partial'
         OR e.assumptions_json->'linear_geometry'->>'lengthMm' IS NULL)
  RETURNING e.id, e.user_id, e.project_id, e.segment_id
)
INSERT INTO public.audit_events (user_id, project_id, segment_id, entity_type, entity_id, action, metadata)
SELECT user_id, project_id, segment_id, 'estimate_item', id, 'accept_synthetic_host_length',
  jsonb_build_object('item_id', id, 'mode', 'bulk')
FROM updated;
