
-- segments: structural elements within a project
CREATE TABLE public.segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  segment_type text NOT NULL DEFAULT 'miscellaneous',
  level_label text,
  zone_label text,
  status text DEFAULT 'draft',
  confidence numeric DEFAULT 0,
  drawing_readiness text DEFAULT 'not_ready',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own segments" ON public.segments FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- estimate_items: line items within a segment
CREATE TABLE public.estimate_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  item_type text DEFAULT 'rebar',
  description text,
  bar_size text,
  quantity_count integer DEFAULT 0,
  total_length numeric DEFAULT 0,
  total_weight numeric DEFAULT 0,
  waste_factor numeric DEFAULT 1.05,
  labor_factor numeric DEFAULT 1.0,
  assumptions_json jsonb DEFAULT '{}',
  exclusions_json jsonb DEFAULT '{}',
  confidence numeric DEFAULT 0,
  status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.estimate_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own estimate_items" ON public.estimate_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- bar_items: individual bars within an estimate item
CREATE TABLE public.bar_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  estimate_item_id uuid,
  user_id uuid NOT NULL,
  mark text,
  shape_code text,
  cut_length numeric DEFAULT 0,
  quantity integer DEFAULT 0,
  size text,
  finish_type text DEFAULT 'black',
  lap_length numeric,
  cover_value numeric,
  confidence numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.bar_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own bar_items" ON public.bar_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- validation_issues: QA issues
CREATE TABLE public.validation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  segment_id uuid,
  sheet_id text,
  user_id uuid NOT NULL,
  issue_type text NOT NULL,
  severity text DEFAULT 'warning',
  title text NOT NULL,
  description text,
  status text DEFAULT 'open',
  assigned_to text,
  resolution_note text,
  source_refs jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.validation_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own validation_issues" ON public.validation_issues FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- drawing_views: draft shop drawing views per segment
CREATE TABLE public.drawing_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  view_type text DEFAULT 'plan',
  title text,
  generated_json jsonb DEFAULT '{}',
  status text DEFAULT 'draft',
  confidence numeric DEFAULT 0,
  revision_label text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.drawing_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own drawing_views" ON public.drawing_views FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- standards_profiles: admin-managed code profiles
CREATE TABLE public.standards_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  code_family text DEFAULT 'CSA A23.3',
  units text DEFAULT 'metric',
  cover_defaults jsonb DEFAULT '{}',
  lap_defaults jsonb DEFAULT '{}',
  hook_defaults jsonb DEFAULT '{}',
  naming_rules jsonb DEFAULT '{}',
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.standards_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own standards_profiles" ON public.standards_profiles FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- approvals: review/approval records
CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  segment_id uuid,
  user_id uuid NOT NULL,
  approval_type text DEFAULT 'estimate',
  status text DEFAULT 'pending',
  reviewer_name text,
  reviewer_email text,
  notes text,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own approvals" ON public.approvals FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
