
ALTER TABLE public.review_shares ADD COLUMN IF NOT EXISTS review_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.review_shares ADD COLUMN IF NOT EXISTS review_type text DEFAULT 'estimation_review';

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL,
  due_date timestamptz,
  status text DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own follow_ups" ON public.follow_ups FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
