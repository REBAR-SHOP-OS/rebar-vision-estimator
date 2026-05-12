## Goal
Make the QA Gate trustworthy again by:
- stopping stale legacy questions from surfacing as current blockers,
- preventing overlays from pointing to the wrong page/place,
- suppressing questions when the row already has enough drawing-backed dimensions/callouts.

## Plan
1. **Repair QA source selection and fallback behavior**
   - Update the workflow QA loader so canonical takeoff warnings are preferred when available.
   - Handle missing canonical bridge-table access gracefully instead of silently falling back to legacy-only data.
   - If the backend is missing the existing bridge tables referenced by the app, apply the already-defined bridge migration so canonical lookups work again.

2. **Filter stale or invalid legacy QA issues**
   - Tighten `loadWorkflowQaIssues` so legacy `validation_issues` are excluded when the linked estimate row already contains resolved/usable geometry, bar callout, or a saved engineer answer.
   - Ignore issues that were generated from synthetic placeholder assumptions when the underlying row now has better data.
   - De-duplicate overlapping warnings/errors for the same estimate item so the QA rail shows the current unresolved issue, not historical leftovers.

3. **Fix page/file/anchor resolution for the overlay**
   - Make the viewer trust only anchors that match the selected issue’s real file and page.
   - Reject approximate excerpt matches when they land on a different page or when the anchor is too generic.
   - Prefer structured location fields and trusted anchor metadata over loose OCR token matching; if confidence is too low, show no pointer rather than a wrong pointer.

4. **Tighten unresolved-question generation**
   - Update the estimator QA issue generation so it does not ask for dimensions/callouts that are already present in `assumptions_json` or derived from explicit drawing text.
   - Keep unresolved questions limited to genuinely missing raw drawing inputs.
   - Prevent synthetic fallback estimates from creating misleading “confirm this” questions unless no stronger source exists.

5. **Validate against this live project and add regression coverage**
   - Verify the current project’s open QA list shrinks to real unresolved items.
   - Confirm selected issues open on the correct page and either point precisely or show no pointer.
   - Add targeted tests for stale legacy filtering, page-safe overlay selection, and “don’t ask when data already exists” behavior.

## Technical details
- Likely files:
  - `src/features/workflow-v2/takeoff-data.ts`
  - `src/features/workflow-v2/stages/QAStage.tsx`
  - `src/lib/rebar-read-model.ts`
  - `supabase/functions/auto-estimate/index.ts`
  - focused test files under `src/test/`
- Minimal-change approach:
  - keep the existing workflow and UI,
  - patch only the QA loading, filtering, and anchor selection logic,
  - only touch backend schema if the existing canonical bridge tables are actually missing from the hosted backend.

## Expected result
- The QA Gate shows fewer, more accurate blockers.
- Wrong-page and wrong-location overlay jumps stop.
- Items that already have the needed dimensions/callouts no longer appear as questions.