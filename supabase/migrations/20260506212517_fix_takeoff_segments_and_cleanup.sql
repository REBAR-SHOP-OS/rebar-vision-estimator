-- Re-classify the 3 segments in the active project so auto-estimate
-- can apply correct prompts and validation gates.
UPDATE public.segments SET segment_type = 'slab'
  WHERE project_id = '3f840fa0-ac95-414e-8471-ad6c2fe8f0fc' AND name = 'SOG Slab-on-Grade';
UPDATE public.segments SET segment_type = 'footing'
  WHERE project_id = '3f840fa0-ac95-414e-8471-ad6c2fe8f0fc' AND name = 'Footings';
UPDATE public.segments SET segment_type = 'wall'
  WHERE project_id = '3f840fa0-ac95-414e-8471-ad6c2fe8f0fc' AND name = 'Walls';

-- Clear stale auto-generated estimate rows + unresolved-geometry issues.
DELETE FROM public.validation_issues
  WHERE project_id = '3f840fa0-ac95-414e-8471-ad6c2fe8f0fc'
    AND issue_type = 'unresolved_geometry';
DELETE FROM public.estimate_items
  WHERE project_id = '3f840fa0-ac95-414e-8471-ad6c2fe8f0fc'
    AND status IN ('unresolved','draft');
