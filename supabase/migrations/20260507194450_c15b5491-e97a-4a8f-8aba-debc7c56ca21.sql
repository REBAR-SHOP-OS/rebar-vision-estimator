ALTER TABLE public.segments
  ADD COLUMN IF NOT EXISTS dimensions_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS dimensions_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS dimensions_locked_by uuid;

CREATE OR REPLACE FUNCTION public.validate_segment_dimensions_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.dimensions_status NOT IN ('pending','partial','complete','na') THEN
    RAISE EXCEPTION 'Invalid dimensions_status: %', NEW.dimensions_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_segment_dimensions_status_trg ON public.segments;
CREATE TRIGGER validate_segment_dimensions_status_trg
  BEFORE INSERT OR UPDATE OF dimensions_status ON public.segments
  FOR EACH ROW EXECUTE FUNCTION public.validate_segment_dimensions_status();

CREATE INDEX IF NOT EXISTS segments_dimensions_status_idx
  ON public.segments (project_id, dimensions_status);