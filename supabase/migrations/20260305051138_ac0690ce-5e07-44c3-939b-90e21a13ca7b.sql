
-- Phase 1: Data Audit Foundation Schema

-- 1. document_versions: immutable PDF version records with SHA-256 hashing
CREATE TABLE public.document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  file_id uuid REFERENCES public.project_files(id) ON DELETE SET NULL,
  sha256 text NOT NULL,
  file_name text,
  file_path text,
  source_system text DEFAULT 'upload',
  upload_timestamp timestamptz DEFAULT now(),
  pdf_metadata jsonb DEFAULT '{}'::jsonb,
  is_scanned boolean DEFAULT false,
  page_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own document_versions" ON public.document_versions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_document_versions_project ON public.document_versions(project_id);
CREATE INDEX idx_document_versions_sha256 ON public.document_versions(sha256);

-- 2. drawing_sets: groups of sheets issued together
CREATE TABLE public.drawing_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  set_name text,
  issue_purpose text DEFAULT 'IFT',
  issue_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drawing_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own drawing_sets" ON public.drawing_sets FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. sheet_revisions: per-sheet revision tracking within drawing sets
CREATE TABLE public.sheet_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drawing_set_id uuid REFERENCES public.drawing_sets(id) ON DELETE CASCADE NOT NULL,
  document_version_id uuid REFERENCES public.document_versions(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  page_number integer,
  sheet_number text,
  sheet_title text,
  discipline text,
  drawing_type text,
  revision_code text,
  revision_date date,
  revision_description text,
  scale_raw text,
  scale_ratio numeric,
  scale_confidence numeric DEFAULT 0,
  extraction_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sheet_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own sheet_revisions" ON public.sheet_revisions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_sheet_revisions_drawing_set ON public.sheet_revisions(drawing_set_id);

-- 4. estimate_versions: versioned estimate snapshots
CREATE TABLE public.estimate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  drawing_set_ids uuid[] DEFAULT '{}',
  line_items jsonb DEFAULT '[]'::jsonb,
  assumptions_text text,
  total_estimated_cost numeric,
  total_quoted_price numeric,
  currency text DEFAULT 'CAD',
  status text DEFAULT 'draft',
  issued_at timestamptz,
  estimator_notes text,
  confidence_score numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.estimate_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own estimate_versions" ON public.estimate_versions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_estimate_versions_project ON public.estimate_versions(project_id);

-- 5. quote_versions: issued proposal versions
CREATE TABLE public.quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_version_id uuid REFERENCES public.estimate_versions(id) ON DELETE CASCADE NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  quoted_price numeric,
  currency text DEFAULT 'CAD',
  terms_text text,
  exclusions_text text,
  issued_at timestamptz,
  status text DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quote_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own quote_versions" ON public.quote_versions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. reconciliation_records: human resolution audit trail
CREATE TABLE public.reconciliation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  issue_type text NOT NULL,
  candidates jsonb DEFAULT '{}'::jsonb,
  automated_reasoning jsonb DEFAULT '{}'::jsonb,
  human_resolution jsonb,
  resolved boolean DEFAULT false,
  resolved_by uuid,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own reconciliation_records" ON public.reconciliation_records FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. symbol_lexicon: rebar notation patterns for extraction
CREATE TABLE public.symbol_lexicon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  lexicon_version text DEFAULT '2026.03.01',
  symbol_id text NOT NULL,
  patterns text[] NOT NULL DEFAULT '{}',
  meaning text NOT NULL,
  unit_default text,
  context jsonb DEFAULT '{}'::jsonb,
  is_global boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.symbol_lexicon ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read global lexicon" ON public.symbol_lexicon FOR SELECT TO authenticated
  USING (is_global = true OR auth.uid() = user_id);
CREATE POLICY "Users can manage own lexicon entries" ON public.symbol_lexicon FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 8. review_queue: active learning signals for low-confidence extractions
CREATE TABLE public.review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  item_type text NOT NULL,
  item_data jsonb DEFAULT '{}'::jsonb,
  confidence numeric DEFAULT 0,
  priority text DEFAULT 'medium',
  status text DEFAULT 'pending',
  resolved_data jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own review_queue" ON public.review_queue FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 9. Add linkage_score to projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS linkage_score text DEFAULT 'L0';

-- 10. Add estimate_version_id and drawing_set_id references to estimate_outcomes
ALTER TABLE public.estimate_outcomes ADD COLUMN IF NOT EXISTS estimate_version_id uuid REFERENCES public.estimate_versions(id) ON DELETE SET NULL;
ALTER TABLE public.estimate_outcomes ADD COLUMN IF NOT EXISTS drawing_set_id uuid REFERENCES public.drawing_sets(id) ON DELETE SET NULL;
