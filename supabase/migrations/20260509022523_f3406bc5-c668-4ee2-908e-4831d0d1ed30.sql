ALTER TABLE public.agent_knowledge ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_knowledge ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS "Users view own knowledge" ON public.agent_knowledge;
CREATE POLICY "Users view own or system knowledge"
ON public.agent_knowledge
FOR SELECT
TO authenticated
USING (is_system = true OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own knowledge" ON public.agent_knowledge;
CREATE POLICY "Users update own knowledge"
ON public.agent_knowledge
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND is_system = false)
WITH CHECK (auth.uid() = user_id AND is_system = false);

DROP POLICY IF EXISTS "Users can delete their own knowledge" ON public.agent_knowledge;
CREATE POLICY "Users delete own non-system knowledge"
ON public.agent_knowledge
FOR DELETE
TO authenticated
USING (auth.uid() = user_id AND is_system = false);