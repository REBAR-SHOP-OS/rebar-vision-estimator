-- 1. segment_source_links: proper traceability table
CREATE TABLE public.segment_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  file_id uuid NOT NULL,
  user_id uuid NOT NULL,
  linked_at timestamptz DEFAULT now(),
  UNIQUE(segment_id, file_id)
);

ALTER TABLE public.segment_source_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own segment_source_links"
  ON public.segment_source_links FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. audit_events: durable event log (insert + select only)
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid,
  segment_id uuid,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own audit_events"
  ON public.audit_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own audit_events"
  ON public.audit_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 3. Add source_file_id to estimate_items
ALTER TABLE public.estimate_items ADD COLUMN IF NOT EXISTS source_file_id uuid;

-- 4. Add source_file_id to validation_issues
ALTER TABLE public.validation_issues ADD COLUMN IF NOT EXISTS source_file_id uuid;