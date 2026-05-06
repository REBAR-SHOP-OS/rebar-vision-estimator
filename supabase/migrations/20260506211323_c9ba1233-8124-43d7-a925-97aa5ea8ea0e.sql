INSERT INTO public.agent_knowledge (user_id, type, title, file_name, content)
SELECT '71a25c13-e42c-4d4f-902f-029798b5b441'::uuid, type, title, file_name, content
FROM public.agent_knowledge
WHERE user_id = 'c67880f7-91e8-4958-a966-081f3953ded1'
  AND file_name = 'Manual-Standard-Practice-2018-RSIC.pdf'
  AND NOT EXISTS (
    SELECT 1 FROM public.agent_knowledge ak2
    WHERE ak2.user_id = '71a25c13-e42c-4d4f-902f-029798b5b441'
      AND ak2.title = public.agent_knowledge.title
  );