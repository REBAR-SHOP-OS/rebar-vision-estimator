
-- Drop the old function signature first (return type changed)
DROP FUNCTION IF EXISTS public.search_drawings(uuid, text, jsonb, integer);

-- Recreate with expanded return columns
CREATE OR REPLACE FUNCTION public.search_drawings(
  p_user_id uuid,
  p_query text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  logical_drawing_id uuid,
  page_number integer,
  sheet_id text,
  discipline text,
  drawing_type text,
  revision_label text,
  issue_status text,
  crm_deal_id text,
  bar_marks text[],
  extracted_entities jsonb,
  project_name text,
  headline text,
  rank real,
  created_at timestamptz,
  confidence numeric,
  sha256 text,
  source_system text,
  quality_flags text[],
  needs_review boolean,
  revision_chain_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tsquery tsquery;
  v_sort text;
  v_min_confidence numeric;
BEGIN
  IF p_query IS NOT NULL AND p_query <> '' THEN
    v_tsquery := plainto_tsquery('english', p_query);
  END IF;

  v_sort := COALESCE(p_filters->>'sort', 'relevance');
  v_min_confidence := COALESCE((p_filters->>'min_confidence')::numeric, 0.0);

  RETURN QUERY
  SELECT
    dsi.id,
    dsi.project_id,
    dsi.logical_drawing_id,
    dsi.page_number,
    ld.sheet_id,
    ld.discipline,
    ld.drawing_type,
    dsi.revision_label,
    dsi.issue_status,
    dsi.crm_deal_id,
    dsi.bar_marks,
    dsi.extracted_entities,
    p.name AS project_name,
    CASE
      WHEN v_tsquery IS NOT NULL THEN ts_headline('english', dsi.raw_text, v_tsquery, 'MaxFragments=2,MaxWords=30,MinWords=10')
      ELSE left(dsi.raw_text, 200)
    END AS headline,
    CASE
      WHEN v_tsquery IS NOT NULL THEN ts_rank(dsi.search_tsv, v_tsquery)
      ELSE 0.0
    END::real AS rank,
    dsi.created_at,
    COALESCE(dsi.confidence, 1.0) AS confidence,
    dsi.sha256,
    dsi.source_system,
    dsi.quality_flags,
    COALESCE(dsi.needs_review, false) AS needs_review,
    ld.revision_chain_id
  FROM public.drawing_search_index dsi
  LEFT JOIN public.logical_drawings ld ON ld.id = dsi.logical_drawing_id
  LEFT JOIN public.projects p ON p.id = dsi.project_id
  WHERE dsi.user_id = p_user_id
    AND (v_tsquery IS NULL OR dsi.search_tsv @@ v_tsquery)
    AND (p_filters->>'project_id' IS NULL OR dsi.project_id = (p_filters->>'project_id')::uuid)
    AND (p_filters->>'discipline' IS NULL OR ld.discipline = p_filters->>'discipline')
    AND (p_filters->>'drawing_type' IS NULL OR ld.drawing_type = p_filters->>'drawing_type')
    AND (p_filters->>'revision' IS NULL OR dsi.revision_label = p_filters->>'revision')
    AND (p_filters->>'crm_deal_id' IS NULL OR dsi.crm_deal_id = p_filters->>'crm_deal_id')
    AND (p_filters->>'bar_mark' IS NULL OR dsi.bar_marks @> ARRAY[p_filters->>'bar_mark'])
    AND (p_filters->>'sheet_id' IS NULL OR ld.sheet_id ILIKE '%' || (p_filters->>'sheet_id') || '%')
    AND (p_filters->>'drawing_set_id' IS NULL OR dsi.drawing_set_id = (p_filters->>'drawing_set_id')::uuid)
    AND (p_filters->>'revision_chain_id' IS NULL OR ld.revision_chain_id = (p_filters->>'revision_chain_id')::uuid)
    AND (COALESCE(dsi.confidence, 1.0) >= v_min_confidence)
    AND (p_filters->>'needs_review' IS NULL OR COALESCE(dsi.needs_review, false) = (p_filters->>'needs_review')::boolean)
  ORDER BY
    CASE WHEN v_sort = 'date' THEN extract(epoch from dsi.created_at) * -1 ELSE 0 END,
    CASE WHEN v_sort = 'sheet' THEN ld.sheet_id ELSE NULL END,
    CASE WHEN v_sort = 'confidence' THEN COALESCE(dsi.confidence, 1.0) ELSE 0 END DESC,
    CASE WHEN v_sort = 'relevance' OR v_sort NOT IN ('date', 'sheet', 'confidence') THEN
      CASE WHEN v_tsquery IS NOT NULL THEN ts_rank(dsi.search_tsv, v_tsquery) ELSE 0.0 END
    ELSE 0 END DESC,
    dsi.created_at DESC
  LIMIT p_limit;
END;
$function$;
