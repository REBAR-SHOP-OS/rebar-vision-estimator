-- Verified estimation pipeline: document registry, sheet index, entities, canonical results, reference lines, export jobs, validation rules.
-- Repo note: production may differ; this migration matches the checked-in app (Supabase/Postgres, blueprints bucket — no extract_* tables in Git).

-- 1. document_registry — classification per uploaded file (not filename-only; app sets from pdf_metadata + rules)
CREATE TABLE public.document_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  file_id uuid NOT NULL REFERENCES public.project_files(id) ON DELETE CASCADE,
  classification text NOT NULL DEFAULT 'unknown',
  validation_role text DEFAULT 'input',
  parse_status text DEFAULT 'pending',
  extraction_status text DEFAULT 'pending',
  is_active boolean NOT NULL DEFAULT true,
  supersedes_file_id uuid REFERENCES public.project_files(id) ON DELETE SET NULL,
  detected_discipline text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, file_id)
);

ALTER TABLE public.document_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own document_registry" ON public.document_registry FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_document_registry_project ON public.document_registry(project_id);

-- 2. document_sheets — per-page index for PDFs
CREATE TABLE public.document_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  document_version_id uuid NOT NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  sheet_number text,
  sheet_title text,
  discipline text,
  title_block_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_version_id, page_number)
);

ALTER TABLE public.document_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own document_sheets" ON public.document_sheets FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_document_sheets_version ON public.document_sheets(document_version_id);
CREATE INDEX idx_document_sheets_project ON public.document_sheets(project_id);

-- 3. sheet_regions — optional bounding regions (normalized layer)
CREATE TABLE public.sheet_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  document_sheet_id uuid NOT NULL REFERENCES public.document_sheets(id) ON DELETE CASCADE,
  region_type text NOT NULL DEFAULT 'unknown',
  label text,
  bounds_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sheet_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sheet_regions" ON public.sheet_regions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_sheet_regions_sheet ON public.sheet_regions(document_sheet_id);

-- 4. extracted_entities — typed extraction rows (normalized; drawing_search_index remains for search)
CREATE TABLE public.extracted_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  document_version_id uuid REFERENCES public.document_versions(id) ON DELETE SET NULL,
  document_sheet_id uuid REFERENCES public.document_sheets(id) ON DELETE SET NULL,
  sheet_region_id uuid REFERENCES public.sheet_regions(id) ON DELETE SET NULL,
  page_number integer,
  entity_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  extraction_method text NOT NULL DEFAULT 'unknown',
  confidence numeric NOT NULL DEFAULT 0,
  validation_status text NOT NULL DEFAULT 'pending',
  review_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.extracted_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own extracted_entities" ON public.extracted_entities FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_extracted_entities_project ON public.extracted_entities(project_id);
CREATE INDEX idx_extracted_entities_sheet ON public.extracted_entities(document_sheet_id);

-- 5. verified_estimate_results — single canonical snapshot per version
CREATE TABLE public.verified_estimate_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  inputs_hash text,
  blocked_reasons jsonb DEFAULT '[]'::jsonb,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verified_estimate_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own verified_estimate_results" ON public.verified_estimate_results FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_verified_estimate_project ON public.verified_estimate_results(project_id);
CREATE INDEX idx_verified_estimate_current ON public.verified_estimate_results(project_id, is_current) WHERE is_current = true;

-- 6. estimate_line_evidence — links canonical lines to entities / files
CREATE TABLE public.estimate_line_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  verified_estimate_result_id uuid NOT NULL REFERENCES public.verified_estimate_results(id) ON DELETE CASCADE,
  line_key text NOT NULL,
  line_index integer,
  extracted_entity_ids uuid[] DEFAULT '{}',
  source_file_id uuid REFERENCES public.project_files(id) ON DELETE SET NULL,
  source_sheet text,
  source_region text,
  extraction_method text,
  confidence numeric,
  validation_status text DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.estimate_line_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own estimate_line_evidence" ON public.estimate_line_evidence FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_estimate_line_evidence_result ON public.estimate_line_evidence(verified_estimate_result_id);

-- 7. reference_answer_lines — structured known-correct rows from reference XLSX
CREATE TABLE public.reference_answer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_file_id uuid REFERENCES public.project_files(id) ON DELETE SET NULL,
  line_key text,
  mark text,
  description text,
  quantity numeric,
  unit text,
  group_label text,
  normalized_key text NOT NULL,
  raw_row jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reference_answer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own reference_answer_lines" ON public.reference_answer_lines FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_reference_answer_project ON public.reference_answer_lines(project_id);
CREATE INDEX idx_reference_answer_norm ON public.reference_answer_lines(project_id, normalized_key);

-- 8. estimation_validation_rules — DB-backed rules (alongside agent_knowledge type=rule)
CREATE TABLE public.estimation_validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  rule_type text NOT NULL DEFAULT 'threshold',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.estimation_validation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own estimation_validation_rules" ON public.estimation_validation_rules FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_estimation_validation_rules_project ON public.estimation_validation_rules(project_id);

-- 9. export_jobs — audit trail for exports from canonical snapshot
CREATE TABLE public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  verified_estimate_result_id uuid REFERENCES public.verified_estimate_results(id) ON DELETE SET NULL,
  export_type text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own export_jobs" ON public.export_jobs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_export_jobs_project ON public.export_jobs(project_id);
