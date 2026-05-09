# Stage 03 — Scan Only Relevant Sheets

## Goal

Stop loading and calibrating every indexed page. Only sheets whose OCR text shows **concrete / rebar-relevant content** (or that already carry a Structural / Foundation discipline tag) should appear in Stage 03 and feed Takeoff. Everything else (architectural-only fit-out, MEP, finishes, cover sheets, indexes) is filtered out before the heavy work runs.

## Relevance rule (single source of truth)

A sheet is **relevant** if ANY of:

1. `sheet_revisions.discipline` or `logical_drawings.discipline` starts with `struct` / `found` / `civil`.
2. Sheet number matches `^S-?`, `^SD-?`, `^F-?`, `^FD-?`, `^C-?` (foundations / structural / civil).
3. `raw_text` (first ~4 KB only) contains any of:
   `concrete`, `rebar`, `reinforc`, `#3..#11`, `bar mark`, `f'c`, `psi`, `MPa`, `slab`, `footing`, `pier`, `pile`, `cap`, `beam`, `column`, `wall reinf`, `lap`, `dowel`, `stirrup`, `tie`, `hook`.
4. `bar_marks` array on `drawing_search_index` is non-empty.

Anything failing all four = filtered out (kept in DB, just hidden from Stage 03 / Takeoff). Estimator can toggle "Show all sheets" if they need to manually pull one back in.

## Patch scope (single file)

Edit only `src/features/workflow-v2/stages/CalibrationStage.tsx`:

1. **Trim the network payload**: change the `drawing_search_index` select to `id, page_number, raw_text:raw_text, sheet_revision_id, logical_drawing_id, document_version_id, bar_marks` and post-process `raw_text` to first 4096 chars before passing to `resolveScale` and the relevance filter. (PostgREST does not support server-side substring; the truncation happens client-side immediately after fetch and is dropped before storing in `sheets` state.)
2. **Add `isRelevantSheet(row, rev, logic)`** helper implementing the four-rule check above.
3. **Filter `rows`** through `isRelevantSheet` before they are set into `sheets`. Track filtered count in a new `hiddenCount` state.
4. **Header chip + toggle**: show `"{visible}/{total} sheets · {hidden} hidden"` with a small "Show all" toggle. When toggled on, the filter is bypassed (estimator can manually mark a stray sheet as Structural).
5. **Cache the resolved sheet list** in `state.local.calibrationCache = { resolved_at, rows }` so re-entering Stage 03 is instant. Invalidate the cache when the user clicks Re-detect.

## Out of scope

- No DB schema changes, no new columns, no migration.
- No edge function changes.
- No changes to `scale-resolver.ts`, `WorkflowShell.tsx`, `TakeoffStage.tsx`, `useWorkflowState.ts`, or any other stage.
- The filter is **display + gate-cohort only** — `drawing_search_index` rows are untouched, so search/audit still sees everything.

## Risk

Low. Worst case: a relevant sheet is mis-filtered (e.g. unusual sheet numbering, OCR missed every keyword). Mitigated by the "Show all" toggle and by rule 4 (any detected `bar_marks` instantly qualifies). Existing `stage-2-to-3-navigation.test.ts` continues to pass since gate logic still runs over the (now smaller) cohort.

## Expected impact

- Cold-load payload drops from ~32 sheets × full OCR (1–6 MB) to relevant subset × 4 KB each (typically <100 KB total).
- Stage 03 renders only the sheets the estimator actually needs to calibrate, so the "Loading…" delay goes from seconds to sub-second and there's no noise from cover/MEP/arch sheets.
