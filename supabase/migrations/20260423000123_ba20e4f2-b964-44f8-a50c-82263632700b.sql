ALTER TABLE public.shop_drawings
  ADD COLUMN IF NOT EXISTS drawing_mode text NOT NULL DEFAULT 'ai_draft',
  ADD COLUMN IF NOT EXISTS validation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS export_class text,
  ADD COLUMN IF NOT EXISTS watermark_mode text NOT NULL DEFAULT 'ai_draft';

ALTER TABLE public.shop_drawings
  ADD CONSTRAINT shop_drawings_drawing_mode_chk
  CHECK (drawing_mode IN ('ai_draft','review_draft','issued'));

ALTER TABLE public.bar_items
  ADD COLUMN IF NOT EXISTS provenance_state text NOT NULL DEFAULT 'ai_inferred',
  ADD COLUMN IF NOT EXISTS deterministic_match boolean NOT NULL DEFAULT false;

ALTER TABLE public.bar_items
  ADD CONSTRAINT bar_items_provenance_state_chk
  CHECK (provenance_state IN ('source_detected','ai_inferred','deterministically_computed','human_confirmed'));