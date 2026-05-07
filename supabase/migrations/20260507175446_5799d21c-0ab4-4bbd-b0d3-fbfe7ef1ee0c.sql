UPDATE public.document_versions
SET parse_status = 'pending', parse_error = NULL
WHERE project_id = 'a24bba42-0120-45ce-be6d-cc5625cf24e5'
  AND parse_status = 'parsing'
  AND parsed_at IS NULL;