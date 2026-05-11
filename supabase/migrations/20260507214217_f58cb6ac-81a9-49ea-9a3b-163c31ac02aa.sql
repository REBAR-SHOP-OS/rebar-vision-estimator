-- Revert synthetic dimension patches on project cd42ebfe (LONDON_CRU1-7)
-- Restores partial geometry status and missing_refs so the dimensions gate engages again.

WITH reverted AS (
  UPDATE public.estimate_items e
  SET assumptions_json = (
        ((COALESCE(e.assumptions_json, '{}'::jsonb)
          - 'confirmation_source'
          - 'confirmed_at')
         || jsonb_build_object('geometry_status', 'partial')
         || jsonb_build_object(
              'missing_refs',
              CASE
                WHEN e.assumptions_json->>'confirmation_source' = 'user_accept_synthetic_bulk'
                  THEN '["host element length"]'::jsonb
                WHEN e.assumptions_json->>'confirmation_source' = 'user_accept_synthetic'
                  THEN '["host element length"]'::jsonb
                ELSE COALESCE(e.assumptions_json->'missing_refs', '[]'::jsonb)
              END
            )
         || jsonb_build_object(
              'linear_geometry',
              CASE
                -- strip the synthetic 10000mm length when it was injected
                WHEN (e.assumptions_json->'linear_geometry'->>'lengthMm')::numeric = 10000
                  THEN COALESCE(e.assumptions_json->'linear_geometry', '{}'::jsonb) - 'lengthMm'
                ELSE COALESCE(e.assumptions_json->'linear_geometry', '{}'::jsonb)
              END
            )
        )
      )
  WHERE e.project_id = 'cd42ebfe-18cc-48c3-b883-fc628c4593e3'
    AND e.assumptions_json->>'confirmation_source' LIKE 'user_accept_synthetic%'
  RETURNING e.id, e.user_id, e.project_id, e.segment_id
),
also_strip_height AS (
  UPDATE public.estimate_items e
  SET assumptions_json = jsonb_set(
        e.assumptions_json,
        '{linear_geometry}',
        COALESCE(e.assumptions_json->'linear_geometry', '{}'::jsonb) - 'heightMm'
      )
  WHERE e.project_id = 'cd42ebfe-18cc-48c3-b883-fc628c4593e3'
    AND (e.assumptions_json->'linear_geometry'->>'heightMm')::numeric = 3000
  RETURNING e.id
),
seg_reset AS (
  UPDATE public.segments s
  SET dimensions_status = 'pending',
      dimensions_locked_at = NULL,
      dimensions_locked_by = NULL
  WHERE s.project_id = 'cd42ebfe-18cc-48c3-b883-fc628c4593e3'
  RETURNING s.id, s.user_id, s.project_id
)
INSERT INTO public.audit_events (user_id, project_id, segment_id, entity_type, entity_id, action, metadata)
SELECT user_id, project_id, segment_id, 'estimate_item', id,
       'revert_synthetic_host_length',
       jsonb_build_object('item_id', id, 'mode', 'bulk_revert',
                          'reason', 'Restoring honest MISSING state; extract-dimensions must run.')
FROM reverted;