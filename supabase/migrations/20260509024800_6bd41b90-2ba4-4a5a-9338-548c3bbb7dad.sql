-- Manual polygon overlays drawn on the takeoff canvas
CREATE TABLE IF NOT EXISTS public.takeoff_overlays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  segment_id uuid NULL,
  page_number integer NOT NULL DEFAULT 1,
  source_file_id uuid NULL,
  polygon jsonb NOT NULL,
  area_sqft numeric NULL,
  color_hint text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.takeoff_overlays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own takeoff_overlays"
  ON public.takeoff_overlays
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS takeoff_overlays_project_idx
  ON public.takeoff_overlays(project_id, page_number);
CREATE INDEX IF NOT EXISTS takeoff_overlays_segment_idx
  ON public.takeoff_overlays(segment_id);

-- Color slot for each segment so the canvas paints buckets consistently
ALTER TABLE public.segments
  ADD COLUMN IF NOT EXISTS overlay_color text NULL;