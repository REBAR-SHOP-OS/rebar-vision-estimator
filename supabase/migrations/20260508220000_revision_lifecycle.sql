-- Phase A: End-to-end revision lifecycle
-- Adds is_current / superseded_by lifecycle fields to estimate_versions (public + rebar),
-- adds indexes to support active-file queries on document_registry, and backfills
-- existing rows so the app can rely on these columns immediately after migration.

-- ============================================================
-- 1. public.estimate_versions lifecycle columns
-- ============================================================

ALTER TABLE public.estimate_versions
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS superseded_by_estimate_version_id uuid
    REFERENCES public.estimate_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

-- One current estimate per project (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_estimate_versions_current
  ON public.estimate_versions (project_id)
  WHERE is_current = true;

-- Supporting index for ordered history queries
CREATE INDEX IF NOT EXISTS idx_public_estimate_versions_project_version
  ON public.estimate_versions (project_id, version_number DESC);

-- Backfill: mark the highest version_number per project as current.
-- All others get is_current = false (already the default, but explicit).
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id ORDER BY version_number DESC, created_at DESC
    ) AS rn
  FROM public.estimate_versions
)
UPDATE public.estimate_versions ev
SET is_current = CASE WHEN r.rn = 1 THEN true ELSE false END
FROM ranked r
WHERE ev.id = r.id;

-- ============================================================
-- 2. rebar.estimate_versions lifecycle columns
-- ============================================================

ALTER TABLE rebar.estimate_versions
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS superseded_by_estimate_version_id uuid
    REFERENCES rebar.estimate_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

-- One current estimate per rebar project
CREATE UNIQUE INDEX IF NOT EXISTS idx_rebar_estimate_versions_current
  ON rebar.estimate_versions (project_id)
  WHERE is_current = true;

-- Backfill rebar.estimate_versions
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id ORDER BY version_number DESC, created_at DESC
    ) AS rn
  FROM rebar.estimate_versions
)
UPDATE rebar.estimate_versions ev
SET is_current = CASE WHEN r.rn = 1 THEN true ELSE false END
FROM ranked r
WHERE ev.id = r.id;

-- ============================================================
-- 3. document_registry: indexes to support active-file queries
-- ============================================================

-- Fast lookup for "active files for a project" (the common hot path)
CREATE INDEX IF NOT EXISTS idx_document_registry_project_active
  ON public.document_registry (project_id, is_active);

-- Supports following supersession chains
CREATE INDEX IF NOT EXISTS idx_document_registry_supersedes
  ON public.document_registry (supersedes_file_id)
  WHERE supersedes_file_id IS NOT NULL;
