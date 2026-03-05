
-- Allow anon to update status on review_shares (so review page can mark as viewed/commented)
CREATE POLICY "Anon can update status"
ON public.review_shares FOR UPDATE TO anon
USING (true)
WITH CHECK (true);
