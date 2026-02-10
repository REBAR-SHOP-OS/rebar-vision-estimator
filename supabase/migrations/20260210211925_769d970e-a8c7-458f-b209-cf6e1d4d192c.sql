
CREATE TABLE public.agent_training_examples (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  blueprint_file_paths TEXT[] DEFAULT '{}',
  blueprint_file_names TEXT[] DEFAULT '{}',
  answer_file_path TEXT,
  answer_file_name TEXT,
  answer_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_training_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own training examples"
ON public.agent_training_examples
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own training examples"
ON public.agent_training_examples
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own training examples"
ON public.agent_training_examples
FOR DELETE
USING (auth.uid() = user_id);
