## Goal

Make the takeoff engine actively **hunt for the answer across the entire drawing set** (every page, every sheet, every schedule, spec note, and detail) before it ever raises a QA question. Only ask the user when a thorough search truly comes back empty.

## Why M039 fails today

For the F-pad row the estimator gave up on its own segment page and asked for "element dimensions" + "rebar callout", even though page 11 already shows the FOUNDATION SCHEDULE with F-1…F-8 dims + reinforcing. Three structural breaks:

1. **Calibration never reaches the estimator.** `CalibrationStage` only stores `pixelsPerFoot` in browser state. `auto-estimate` reads from `document_sheets` — a table that does not exist in this DB. Real table is `sheet_revisions` (currently empty for this project). Result: every run sees `scale_ratio = null`.
2. **Cross-page schedule lookup never happens.** The per-segment prompt is given only that segment's scope name + a few file rows. No schedule rows, no spec sheets, no other pages. So "Schedule not found in segment" is literally true — we never showed it to the model.
3. **No schedule mark on the row.** Items are saved without a `schedule_mark` (F-1, F-2…), so even a later lookup can't re-anchor the row to its schedule entry.

## Plan — Smart Resolver before Ask

Order matters: the resolver runs *inside* `auto-estimate` so the model receives evidence before it decides to ask.

### A. Persist calibration so the estimator can use it
- On `CalibrationStage` → "Confirm calibration", upsert per-sheet `scale_ratio`, `scale_raw`, `scale_confidence` (and `pixels_per_foot` in `extraction_metadata`) into `sheet_revisions`, keyed by `(drawing_set_id, page_number)`.
- Switch `auto-estimate` from `document_sheets` to `sheet_revisions`. Keep the same `sheetMetaByKey` shape so downstream code is untouched.

### B. Build a project-wide Knowledge Pack (the "search the whole drawing" layer)
Before invoking the model for a segment, `auto-estimate` assembles a compact, structured pack from data we already have:

1. **Schedules across all pages** — pull rows from `drawing_search_index` / `symbol_lexicon` where `extracted_entities` flags a schedule (Foundation, Column, Pier, Wall, Beam). Compress to: `mark | size | reinforcing | source_page`.
2. **General notes & rebar legend** — short excerpts from sheets tagged structural notes / general notes.
3. **Spec callouts referenced by mark** — for each scope bucket, pull every line in the search index that mentions that mark family (e.g. `F-`, `WF-`, `C-`, `P-`).
4. **Calibration table** — `{page → scale_ratio, pixels_per_foot}` for every calibrated sheet.

The pack is capped (~6–8 KB) and included in the prompt under a `Project Knowledge:` block. Order: schedule rows first, then notes, then loose callouts.

### C. Force the model to resolve before asking
Update the estimator system prompt with a hard rule:

> Before emitting `missing_refs` for an item, you MUST search the `Project Knowledge` block for the item's mark, type family, and synonyms. If a schedule entry, note, or callout resolves the dimension or reinforcing, use it and set `schedule_mark` + `schedule_source_page`. Only emit `missing_refs` when no entry on any page resolves the question.

Also tighten the output schema:
- Add required `schedule_mark` (nullable) and `schedule_source_page` (nullable).
- `missing_refs` may not contain `"element dimensions"` if `schedule_mark` is set.

### D. Server-side fallback resolver (deterministic, no AI)
After the model returns, run a second pass in `auto-estimate`:
- For any item with empty dims **and** a recognizable mark in `description` (`F-1`, `WF-2`, `C3`…), look up the mark in the schedule pack.
- If found, fill `bar_size`, `total_length` (using calibrated scale when needed), `total_weight`, set `schedule_mark`, set `assumptions_json.resolved_by = "schedule_lookup"`, and clear matching entries from `missing_refs`.
- Only items still empty after this pass survive into `validation_issues`.

### E. QA gate respects the resolution
In `takeoff-data.ts` `legacyIssueAlreadyAnswered`, treat any item with `schedule_mark` + non-zero dims as answered, even if the legacy issue row is still open. Re-run QA Gate button (already added) clears them on click.

### F. Re-run path
- Existing per-segment **Re-run** button on TakeoffStage triggers the new resolver.
- Existing **Re-run QA Gate** button refreshes the count.
- No full project rebuild required.

## Files to touch

- `src/features/workflow-v2/stages/CalibrationStage.tsx` — persist scale on confirm.
- `supabase/functions/auto-estimate/index.ts` — switch source table, build knowledge pack, tighten prompt + schema, run deterministic fallback resolver.
- `src/features/workflow-v2/takeoff-data.ts` — honor `schedule_mark` in QA filter.
- Migration: ensure `sheet_revisions.extraction_metadata` is used for `pixels_per_foot` (no schema change needed — column already exists as JSONB).

No UI redesign. No changes to ScopeStage or QAStage layout. Estimator output table stays the same shape.

## Validation against this project

1. Re-run takeoff for the Pad Footings segment → M039 should populate `bar_size`, `total_length`, `total_weight` from F-1…F-8 schedule on page 11; `assumptions_json.schedule_mark` set; `assumptions_json.resolved_by = "schedule_lookup"`.
2. Re-run QA Gate → M039 + the sibling isolated footing row drop out of open issues.
3. Spot-check Wall Footings (WF schedule) and Columns (C schedule) — same behavior, no regressions.
4. Force a synthetic case where the mark genuinely doesn't exist in any schedule → confirm a question is still raised (we only suppress questions when an answer was actually found).