DROP POLICY IF EXISTS "Anon can read by share_token" ON public.review_shares;
DROP POLICY IF EXISTS "Anon read by token header" ON public.review_shares;
DROP POLICY IF EXISTS "Anon can update status" ON public.review_shares;
DROP POLICY IF EXISTS "Anon update by token header" ON public.review_shares;

CREATE POLICY "Anon read unexpired share by token header"
  ON public.review_shares FOR SELECT TO anon
  USING (
    share_token = current_setting('request.headers', true)::json->>'x-share-token'
    AND (expires_at IS NULL OR expires_at > now())
  );

CREATE POLICY "Anon update unexpired share by token header"
  ON public.review_shares FOR UPDATE TO anon
  USING (
    share_token = current_setting('request.headers', true)::json->>'x-share-token'
    AND (expires_at IS NULL OR expires_at > now())
  )
  WITH CHECK (
    share_token = current_setting('request.headers', true)::json->>'x-share-token'
    AND (expires_at IS NULL OR expires_at > now())
  );

DROP POLICY IF EXISTS "Anon can read comments" ON public.review_comments;
DROP POLICY IF EXISTS "Anon read comments by token" ON public.review_comments;

CREATE POLICY "Anon read comments by unexpired token"
  ON public.review_comments FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.review_shares rs
      WHERE rs.id = review_comments.share_id
        AND rs.share_token = current_setting('request.headers', true)::json->>'x-share-token'
        AND (rs.expires_at IS NULL OR rs.expires_at > now())
    )
  );
