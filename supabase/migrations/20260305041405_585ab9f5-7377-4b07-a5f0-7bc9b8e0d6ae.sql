
-- Drop all existing restrictive policies on review_shares
DROP POLICY IF EXISTS "Anon can read by share_token" ON public.review_shares;
DROP POLICY IF EXISTS "Anon can update status" ON public.review_shares;
DROP POLICY IF EXISTS "Owner can manage their shares" ON public.review_shares;

-- Drop all existing restrictive policies on review_comments
DROP POLICY IF EXISTS "Anon can insert comments" ON public.review_comments;
DROP POLICY IF EXISTS "Anon can read comments" ON public.review_comments;
DROP POLICY IF EXISTS "Owner can read comments on their shares" ON public.review_comments;

-- Recreate as PERMISSIVE policies on review_shares
CREATE POLICY "Anon can read by share_token"
ON public.review_shares FOR SELECT TO anon
USING (true);

CREATE POLICY "Anon can update status"
ON public.review_shares FOR UPDATE TO anon
USING (true) WITH CHECK (true);

CREATE POLICY "Owner can manage their shares"
ON public.review_shares FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Recreate as PERMISSIVE policies on review_comments
CREATE POLICY "Anon can insert comments"
ON public.review_comments FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "Anon can read comments"
ON public.review_comments FOR SELECT TO anon
USING (true);

CREATE POLICY "Owner can read comments on their shares"
ON public.review_comments FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM review_shares rs
  WHERE rs.id = review_comments.share_id AND rs.user_id = auth.uid()
));
