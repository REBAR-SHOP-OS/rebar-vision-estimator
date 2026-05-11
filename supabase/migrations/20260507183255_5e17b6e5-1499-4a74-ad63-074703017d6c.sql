ALTER TABLE public.bar_items
  ADD COLUMN IF NOT EXISTS lap_source text,
  ADD COLUMN IF NOT EXISTS cover_source text,
  ADD COLUMN IF NOT EXISTS grade_source text;