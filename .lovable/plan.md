## Goal
Make Stage 03 generate segment-specific takeoff rows from the correct drawings, with correct evidence links, and replace the current bad rows so the workspace reflects reality.

## What I’ll change

### 1. Fix scope-to-segment typing at approval time
Update the scope approval flow so approved segments keep a meaningful `segment_type` instead of always being saved as `miscellaneous`.

Why this matters:
- your current project has `SOG Slab-on-Grade`, `Footings`, and `Walls`, but all 3 were stored as `miscellaneous`
- `auto-estimate` uses `segment.segment_type` for prompt context and validation gates
- bad segment typing makes the estimator treat unrelated elements too loosely

Files:
- `src/features/workflow-v2/stages/ScopeStage.tsx`

### 2. Restrict `auto-estimate` to the right OCR context for each segment
Refactor the edge function so it no longer estimates each segment from the full mixed project OCR corpus.

Current problem confirmed in this project:
- the function reads all indexed pages for the project
- architectural and structural pages are mixed into one prompt
- the same wall/frost slab/housekeeping-pad lines are being extracted into multiple segments
- all three segments ended up with mostly the same unresolved rows

Fix:
- load drawing index rows with `document_version_id` in addition to page text
- build per-file / per-discipline page groups
- choose pages relevant to the segment:
  - `slab` / SOG -> slab-on-grade, WWM, slab detail pages
  - `footing` -> footing schedule/detail pages
  - `wall` -> foundation wall / wall detail pages
- keep architectural sheets as optional context only, never as a quantity source
- prefer structural/shop pages that actually mention the segment tokens

Files:
- `supabase/functions/auto-estimate/index.ts`

### 3. Fix row evidence and preview linking
Right now evidence is misleading because the estimator only has `page_number` and guessed `source_sheet`, so it falls back to the structural PDF even when page numbers overlap across files.

Fix:
- use `document_version_id` from `drawing_search_index` to resolve the actual source file for each extracted row
- attach the correct `source_file_id` and page metadata to `estimate_items`
- propagate that same source file to generated QA issues so the right sheet opens in the preview panel

Files:
- `supabase/functions/auto-estimate/index.ts`
- possibly `src/features/workflow-v2/takeoff-data.ts` if a small loader adjustment is needed

### 4. Replace stale bad rows on re-run
The current project already contains bad rows, and the existing de-dup logic will otherwise preserve them.

Fix:
- on segment re-run, replace stale auto-generated unresolved/draft rows for that segment before inserting the fresh result set
- clear related unresolved QA issues for that same segment so QA reflects the new run

This avoids keeping the current polluted dataset after the estimator is corrected.

Files:
- `supabase/functions/auto-estimate/index.ts`

### 5. Re-validate on this exact project
After patching, I’ll verify the real outcome by checking that:
- rows differ meaningfully by segment instead of repeating across all groups
- `SOG Slab-on-Grade` shows slab/mesh-related items
- `Footings` shows footing-related items
- `Walls` shows wall-related items
- evidence links point to the correct PDF and page
- QA blockers drop from “everything unresolved” to only genuinely unresolved rows

## Technical notes
- Confirmed from data: all current segments are saved as `miscellaneous`
- Confirmed from data: all 25 current rows are unresolved and repeated across segments
- Confirmed from code: `auto-estimate` queries `drawing_search_index` without `document_version_id`, so file provenance is lost during takeoff generation
- Confirmed from code: unresolved QA issues are inserted with `source_file_id: null`, which weakens traceability
- Confirmed from DB: this project has two indexed PDFs with overlapping page numbers, so page-only matching is not reliable

## Expected result
After implementation, takeoff should stop cloning the same OCR snippets into every segment and instead produce segment-specific rows tied to the correct source drawing.

Approve this plan and I’ll implement the minimal patch.