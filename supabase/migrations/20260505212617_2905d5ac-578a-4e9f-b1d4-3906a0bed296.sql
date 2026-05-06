DROP POLICY IF EXISTS "Service role full access" ON public.notifications;
CREATE POLICY "Service role manages notifications"
  ON public.notifications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can read by share_token" ON public.review_shares;
DROP POLICY IF EXISTS "Anon can update status" ON public.review_shares;
CREATE POLICY "Anon read by token header"
  ON public.review_shares FOR SELECT TO anon
  USING (share_token = current_setting('request.headers', true)::json->>'x-share-token');
CREATE POLICY "Anon update by token header"
  ON public.review_shares FOR UPDATE TO anon
  USING (share_token = current_setting('request.headers', true)::json->>'x-share-token')
  WITH CHECK (share_token = current_setting('request.headers', true)::json->>'x-share-token');

DROP POLICY IF EXISTS "Anon can read comments" ON public.review_comments;
DROP POLICY IF EXISTS "Anon can insert comments" ON public.review_comments;
CREATE POLICY "Anon read comments by token"
  ON public.review_comments FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.review_shares rs
    WHERE rs.id = review_comments.share_id
      AND rs.share_token = current_setting('request.headers', true)::json->>'x-share-token'
  ));
CREATE POLICY "Anon insert comment by token"
  ON public.review_comments FOR INSERT TO anon
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.review_shares rs
    WHERE rs.id = review_comments.share_id
      AND rs.share_token = current_setting('request.headers', true)::json->>'x-share-token'
      AND (rs.expires_at IS NULL OR rs.expires_at > now())
  ));

DROP POLICY IF EXISTS "All authenticated users can view knowledge" ON public.agent_knowledge;
DROP POLICY IF EXISTS "Authenticated users can update knowledge" ON public.agent_knowledge;
CREATE POLICY "Users view own knowledge"
  ON public.agent_knowledge FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users update own knowledge"
  ON public.agent_knowledge FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "All authenticated users can view training examples" ON public.agent_training_examples;
CREATE POLICY "Users view own training examples"
  ON public.agent_training_examples FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='blueprints_owner_update') THEN
    CREATE POLICY "blueprints_owner_update"
      ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'blueprints' AND (auth.uid())::text = (storage.foldername(name))[1])
      WITH CHECK (bucket_id = 'blueprints' AND (auth.uid())::text = (storage.foldername(name))[1]);
  END IF;
END $$;