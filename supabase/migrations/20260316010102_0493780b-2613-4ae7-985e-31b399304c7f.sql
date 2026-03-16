
-- Add scope source tracking to estimate_versions
ALTER TABLE public.estimate_versions
  ADD COLUMN IF NOT EXISTS scope_source_type text DEFAULT 'real_project',
  ADD COLUMN IF NOT EXISTS scope_source_reference text,
  ADD COLUMN IF NOT EXISTS scope_confidence numeric DEFAULT 0;

-- Add workflow columns to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workflow_status text DEFAULT 'intake',
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS normalized_name text,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid,
  ADD COLUMN IF NOT EXISTS intake_complete boolean DEFAULT false;

-- Create scope_templates table
CREATE TABLE IF NOT EXISTS public.scope_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  scope_items text[] NOT NULL DEFAULT '{}',
  project_type text,
  description text,
  is_system boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scope_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read system templates" ON public.scope_templates
  FOR SELECT TO authenticated USING (is_system = true OR auth.uid() = user_id);
CREATE POLICY "Users can manage own templates" ON public.scope_templates
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Create audit_log table
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid,
  action text NOT NULL,
  details jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own audit logs" ON public.audit_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own audit logs" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
