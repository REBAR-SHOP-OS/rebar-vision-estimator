ALTER TABLE public.document_versions
  ADD COLUMN IF NOT EXISTS parse_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS parse_error text,
  ADD COLUMN IF NOT EXISTS parsed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_document_versions_project_status
  ON public.document_versions (project_id, parse_status);