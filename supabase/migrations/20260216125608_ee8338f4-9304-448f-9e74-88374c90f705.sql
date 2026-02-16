
-- Add project metadata fields for scope definition
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS project_type text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS scope_items text[];
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS deviations text;
