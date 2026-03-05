
-- Allow users to update their own knowledge entries
CREATE POLICY "Users can update their own knowledge"
ON public.agent_knowledge FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
