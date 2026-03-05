DROP POLICY IF EXISTS "Users can update their own knowledge" ON public.agent_knowledge;
CREATE POLICY "Authenticated users can update knowledge"
ON public.agent_knowledge FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);