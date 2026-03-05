
-- Create review_shares table
CREATE TABLE public.review_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  reviewer_email text NOT NULL,
  reviewer_name text,
  share_token text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + interval '30 days')
);

ALTER TABLE public.review_shares ENABLE ROW LEVEL SECURITY;

-- Owner can do everything
CREATE POLICY "Owner can manage their shares"
ON public.review_shares FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Anon can read by share_token (for public review page)
CREATE POLICY "Anon can read by share_token"
ON public.review_shares FOR SELECT TO anon
USING (true);

-- Create review_comments table
CREATE TABLE public.review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid REFERENCES public.review_shares(id) ON DELETE CASCADE NOT NULL,
  author_name text NOT NULL,
  author_email text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.review_comments ENABLE ROW LEVEL SECURITY;

-- Anon can insert comments
CREATE POLICY "Anon can insert comments"
ON public.review_comments FOR INSERT TO anon
WITH CHECK (true);

-- Anon can read comments (for the review page)
CREATE POLICY "Anon can read comments"
ON public.review_comments FOR SELECT TO anon
USING (true);

-- Authenticated owner can read comments on their shares
CREATE POLICY "Owner can read comments on their shares"
ON public.review_comments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.review_shares rs
    WHERE rs.id = share_id AND rs.user_id = auth.uid()
  )
);

-- Enable realtime for review_comments
ALTER PUBLICATION supabase_realtime ADD TABLE public.review_comments;
