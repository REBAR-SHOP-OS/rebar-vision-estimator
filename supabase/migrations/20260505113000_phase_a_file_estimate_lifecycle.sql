-- Phase A lifecycle: active file revisions + current estimate versions

CREATE INDEX IF NOT EXISTS idx_document_registry_project_active
  ON public.document_registry(project_id, is_active);

CREATE INDEX IF NOT EXISTS idx_document_registry_supersedes_file_id
  ON public.document_registry(supersedes_file_id);

WITH ranked_registry AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, classification, COALESCE(detected_discipline, '')
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.document_registry
)
UPDATE public.document_registry dr
SET is_active = (ranked_registry.rn = 1)
FROM ranked_registry
WHERE dr.id = ranked_registry.id
  AND dr.is_active IS DISTINCT FROM (ranked_registry.rn = 1);

ALTER TABLE public.estimate_versions
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;

ALTER TABLE public.estimate_versions
  ADD COLUMN IF NOT EXISTS superseded_by_estimate_version_id uuid REFERENCES public.estimate_versions(id) ON DELETE SET NULL;

ALTER TABLE public.estimate_versions
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

ALTER TABLE public.estimate_versions
  ADD COLUMN IF NOT EXISTS source_file_ids uuid[] DEFAULT '{}'::uuid[];

ALTER TABLE public.estimate_versions
  ADD COLUMN IF NOT EXISTS source_document_version_ids uuid[] DEFAULT '{}'::uuid[];

WITH ranked_estimates AS (
  SELECT
    id,
    project_id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id
      ORDER BY version_number DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.estimate_versions
)
UPDATE public.estimate_versions ev
SET
  is_current = (ranked_estimates.rn = 1),
  superseded_at = CASE
    WHEN ranked_estimates.rn = 1 THEN NULL
    ELSE COALESCE(ev.superseded_at, now())
  END
FROM ranked_estimates
WHERE ev.id = ranked_estimates.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_estimate_versions_one_current_per_project
  ON public.estimate_versions(project_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_estimate_versions_project_version_desc
  ON public.estimate_versions(project_id, version_number DESC);