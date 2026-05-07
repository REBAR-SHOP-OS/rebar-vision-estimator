UPDATE public.segments
SET dimensions_status = 'complete',
    dimensions_locked_at = now(),
    updated_at = now()
WHERE project_id = '3aa61dc8-5a84-43af-89c4-de052135201c'
  AND dimensions_status IN ('pending','partial');