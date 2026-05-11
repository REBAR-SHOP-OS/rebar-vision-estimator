ALTER TABLE public.standards_profiles
  ADD COLUMN IF NOT EXISTS waste_factors jsonb NOT NULL DEFAULT '{"small":1.03,"large":1.05,"stirrup":1.08}'::jsonb;