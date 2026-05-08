## Goal

When the user clicks **Run Segment** on a row in Stage 03 (Takeoff), the app should:

1. Make sure the project's drawings are OCR-indexed (no more `DRAWING_DATA_MISSING` 422).
2. Run takeoff for **only that one segment**, so the AI focuses on a small portion → better accuracy.
3. Show clear progress: `Indexing… → OCR entities → Takeoff…`.

Today the button calls `auto-estimate` directly with `segment_id`. If the project has zero indexed pages (current case), it fails with 422 and nothing happens.

## Behavior change (single button, smarter)

`Run Segment` becomes a 3-step pipeline executed in order, only doing what's needed:

```text
[1] Ensure indexed
    ├─ Check document_versions / drawing_search_index for project
    ├─ If 0 indexed pages → run parseAndIndexFile() for each project_files row
    │      (same helper FilesStage already uses; force=false so it's idempotent)
    └─ Update button label: "Indexing 1/2…"

[2] Refresh OCR entities (light)
    └─ Invoke reindex-extractors (already wired) so callouts/dims are fresh
       Label: "Reading drawings…"

[3] Run takeoff scoped to this segment only
    └─ supabase.functions.invoke("auto-estimate", { segment_id, project_id })
       Label: "Running segment…"
```

Steps 1 and 2 are skipped automatically when already done, so re-runs stay fast.

## Scope of edits (minimal patch)

Only one file changes: `src/features/workflow-v2/stages/TakeoffStage.tsx`.

- Extend the existing `runSingleSegment(segName)` function:
  - Before invoking `auto-estimate`, query `document_versions` count for the project.
  - If 0 → loop through `state.files` and call `parseAndIndexFile(projectId, file)` (already imported at the top of this file).
  - Then call `reindex-extractors` (already wired via `handleReindex`) — extracted into a small inner helper so it can be reused without the toast spam.
  - Then call `auto-estimate` exactly as today.
- Replace the single `segRunning` boolean label with a `segPhase` string: `"indexing" | "ocr" | "takeoff"` so the button text reflects the current step.
- Keep the existing toast for 422 errors as a fallback (shouldn't fire anymore once indexing runs first).

No edge-function changes, no DB schema changes, no UI restructuring. The "Re-index OCR Entities" and "Generate Takeoff" buttons in the header keep working unchanged.

## Out of scope (intentionally)

- Page-level OCR scoping (only OCR pages relevant to a segment). The `auto-estimate` function already filters by `segment_id`; OCR is project-wide because we don't yet have a reliable segment→page mapping. If the user later wants true per-page scoping, that's a follow-up.
- Renaming the button or restyling the segment cards.
- Changing how `Best-Guess Estimate` or `Generate Takeoff` work.

## Acceptance check

On the current project (`38c049c8…`, 2 PDFs, 0 indexed pages):

1. Click **Run Segment** on `Pile Caps / Pad Footings`.
2. Button cycles: `Indexing 1/2 → Indexing 2/2 → Reading drawings → Running segment…`.
3. Toast: `Segment "Pile Caps / Pad Footings" re-run: N item(s)`.
4. No `DRAWING_DATA_MISSING` 422.
5. Clicking Run Segment on a second segment skips step 1 (already indexed) and is fast.
