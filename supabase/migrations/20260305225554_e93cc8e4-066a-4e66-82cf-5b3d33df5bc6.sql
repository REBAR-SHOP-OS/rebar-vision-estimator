
-- Allow all authenticated users to read all knowledge
DROP POLICY IF EXISTS "Users can view their own knowledge" ON public.agent_knowledge;
CREATE POLICY "All authenticated users can view knowledge"
ON public.agent_knowledge FOR SELECT TO authenticated
USING (true);

-- Allow all authenticated users to read all training examples  
DROP POLICY IF EXISTS "Users can view their own training examples" ON public.agent_training_examples;
CREATE POLICY "All authenticated users can view training examples"
ON public.agent_training_examples FOR SELECT TO authenticated
USING (true);
