1. Fix the immediate TypeScript blocker
- Patch `src/lib/wall-geometry-resolver.ts` so its helper return type matches the actual `"not_found"` fallback.
- Keep this as the smallest possible change so the app can compile again before validating estimate behavior.

2. Make the geometry resolver recognize your wall/brick-ledge examples
- Patch the estimate resolver in `supabase/functions/auto-estimate/index.ts` with minimal targeted logic for the patterns shown in your screenshot and stored rows:
  - brick ledge lines like `10M VERTICAL BARS @ 300mm O.C.`
  - continuous top reinforcement like `15M CONT. REINFORCEMENT @ TOP OF BRICK LEDGE`
  - wall lines like `15M @ 406mm O.C. MIDDLE EACH WAY`
  - dowel lines like `15M x 457mm LONG @ 610mm O.C. STAGGERED`
- Improve the current regex/path so those rows become at least `partial` with real quantity and/or length evidence when the drawing contains enough literal information, instead of staying fully `unresolved` with all zeros.
- Preserve the existing trust-first rule: if the drawing still does not prove a full number, keep it partial rather than inventing values.

3. Tighten the unresolved fallback so one estimate is actually produced
- Adjust the resolver flow so when a row already contains a literal piece length, spacing, or explicit bar count from OCR, that evidence is preserved into numeric output.
- This will let the UI show a real estimate line similar to your example instead of only `Ask` / `Need run` placeholders.
- Keep the patch narrow and only affect the stuck unresolved cases.

4. Validate against your current backend data
- Re-run the estimator on the affected segment/project and confirm that:
  - at least one row gets numeric estimate values
  - geometry status moves from `unresolved` to `partial` or `resolved`
  - the segment table no longer shows all rows as blocked for that example
- Check the latest estimate rows in the backend to verify the stored values match what the UI shows.

Technical details
- Files to change:
  - `src/lib/wall-geometry-resolver.ts`
  - `supabase/functions/auto-estimate/index.ts`
- Files to verify/read during implementation:
  - `src/features/workflow-v2/stages/TakeoffStage.tsx`
  - `src/features/workflow-v2/takeoff-data.ts`
- Root cause found so far:
  - There is a compile blocker in the shared wall geometry helper.
  - Your latest project does create `estimate_items`, but they remain mostly `geometry_status = unresolved` because the current deterministic resolver is not converting the extracted OCR callouts into numeric qty/length/weight for the wall and brick-ledge patterns in your example.
  - For the project ID from your earlier broken workspace, all 11 rows are still unresolved; for the newest uploaded project, 13 rows exist and 6 are already partial, which shows the pipeline is close but still missing the exact pattern handling needed for your sample.

If you approve, I’ll apply the minimal patch and verify that at least one estimate line is produced from your example.