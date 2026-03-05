
-- Phase 1: Search DB Schema

-- Table: logical_drawings
CREATE TABLE public.logical_drawings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  sheet_id text,
  discipline text,
  drawing_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id, sheet_id, drawing_type)
);

ALTER TABLE public.logical_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own logical_drawings"
  ON public.logical_drawings FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Table: drawing_search_index
CREATE TABLE public.drawing_search_index (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  logical_drawing_id uuid REFERENCES public.logical_drawings(id) ON DELETE CASCADE,
  document_version_id uuid REFERENCES public.document_versions(id) ON DELETE SET NULL,
  sheet_revision_id uuid REFERENCES public.sheet_revisions(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  page_number integer,
  extracted_entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_text text NOT NULL DEFAULT '',
  search_tsv tsvector,
  bar_marks text[] NOT NULL DEFAULT '{}'::text[],
  crm_deal_id text,
  revision_label text,
  issue_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drawing_search_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own drawing_search_index"
  ON public.drawing_search_index FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- GIN indexes
CREATE INDEX idx_search_tsv ON public.drawing_search_index USING GIN (search_tsv);
CREATE INDEX idx_bar_marks ON public.drawing_search_index USING GIN (bar_marks);
CREATE INDEX idx_extracted_entities ON public.drawing_search_index USING GIN (extracted_entities);
CREATE INDEX idx_search_project ON public.drawing_search_index (project_id);
CREATE INDEX idx_search_user ON public.drawing_search_index (user_id);

-- Trigger to auto-populate search_tsv from raw_text
CREATE OR REPLACE FUNCTION public.update_search_tsv()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', coalesce(NEW.raw_text, '') || ' ' || coalesce(NEW.revision_label, '') || ' ' || coalesce(NEW.crm_deal_id, '') || ' ' || coalesce(NEW.issue_status, ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_search_tsv
  BEFORE INSERT OR UPDATE ON public.drawing_search_index
  FOR EACH ROW EXECUTE FUNCTION public.update_search_tsv();

-- Security definer search function
CREATE OR REPLACE FUNCTION public.search_drawings(
  p_user_id uuid,
  p_query text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
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
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tsquery tsquery;
BEGIN
  IF p_query IS NOT NULL AND p_query <> '' THEN
    v_tsquery := plainto_tsquery('english', p_query);
  END IF;

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
    dsi.created_at
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
    AND (p_filters->>'sheet_id' IS NULL OR ld.sheet_id = p_filters->>'sheet_id')
  ORDER BY rank DESC, dsi.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Upsert function for edge functions
CREATE OR REPLACE FUNCTION public.upsert_search_index(
  p_user_id uuid,
  p_project_id uuid,
  p_logical_drawing_id uuid,
  p_document_version_id uuid DEFAULT NULL,
  p_sheet_revision_id uuid DEFAULT NULL,
  p_page_number integer DEFAULT NULL,
  p_raw_text text DEFAULT '',
  p_extracted_entities jsonb DEFAULT '{}'::jsonb,
  p_bar_marks text[] DEFAULT '{}'::text[],
  p_crm_deal_id text DEFAULT NULL,
  p_revision_label text DEFAULT NULL,
  p_issue_status text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.drawing_search_index (
    user_id, project_id, logical_drawing_id, document_version_id,
    sheet_revision_id, page_number, raw_text, extracted_entities,
    bar_marks, crm_deal_id, revision_label, issue_status
  ) VALUES (
    p_user_id, p_project_id, p_logical_drawing_id, p_document_version_id,
    p_sheet_revision_id, p_page_number, p_raw_text, p_extracted_entities,
    p_bar_marks, p_crm_deal_id, p_revision_label, p_issue_status
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
