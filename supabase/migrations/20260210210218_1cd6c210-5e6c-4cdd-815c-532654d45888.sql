
CREATE TABLE public.agent_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT,
  content TEXT,
  file_path TEXT,
  file_name TEXT,
  type TEXT NOT NULL DEFAULT 'rule' CHECK (type IN ('rule', 'file')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own knowledge"
ON public.agent_knowledge FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own knowledge"
ON public.agent_knowledge FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own knowledge"
ON public.agent_knowledge FOR DELETE
USING (auth.uid() = user_id);
