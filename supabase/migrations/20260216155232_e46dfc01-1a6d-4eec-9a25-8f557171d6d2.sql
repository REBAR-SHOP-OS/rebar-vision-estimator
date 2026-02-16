
CREATE TABLE public.shop_drawings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  html_content text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.shop_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own shop drawings"
  ON public.shop_drawings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own shop drawings"
  ON public.shop_drawings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own shop drawings"
  ON public.shop_drawings FOR DELETE
  USING (auth.uid() = user_id);
