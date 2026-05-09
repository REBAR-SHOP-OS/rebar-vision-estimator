## Goal

After upload, the app already runs `parseAndIndexFile` (OCR → `drawing_search_index`). What's missing:
1. The OCR text isn't held in the workflow's "project memory" (the per-project `local` state) — every downstream stage re-fetches it.
2. Dimensions are only extracted when the user manually triggers it, so Stage 04 (Takeoff) and the estimate aren't pre-armed.

This plan wires both into the existing post-upload pipeline so by the time the user reaches Calibration / Takeoff, OCR is cached and dimensions are already resolved per segment.

## Changes (minimum patch, no rewrites)

### 1. `src/lib/parse-file.ts`
- After successful indexing, return the `pages` array (page_number + raw_text + title_block + ocr_metadata) in `ParseFileResult` so the caller can cache it without a second DB hit.

### 2. `src/features/workflow-v2/stages/FilesStage.tsx` (`handleUpload` + `handleReindexAll`)
- After the per-file `parseAndIndexFile` loop finishes successfully:
  - Build an in-memory map `{ [fileId]: { pages: [...], indexed_at } }` and persist via `state.setLocal({ ocrCache: { ...prev, ...new } })`. This is the "temporary project memory" — survives reloads (localStorage) and is read by Scope/Calibration/Takeoff/Assistant without re-querying.
  - Fire `supabase.functions.invoke("extract-dimensions", { body: { project_id: projectId } })` once after the batch (not per file). Toast: "Pre-computing dimensions for takeoff…". On success, write `state.setLocal({ dimensionsCache: { resolved_at, segments: <summary> } })` with the returned segment summary (id, geometry, missing_fields, confidence). Failures are non-fatal — log + toast warning, takeoff still works on demand.

### 3. `src/features/workflow-v2/useWorkflowState.ts`
- Add typed accessors `local.ocrCache` and `local.dimensionsCache` (no schema changes — already free-form `local`). No state shape change required; this step is documentation-only inside the file (1–2 line JSDoc on `local`).

### 4. `src/features/workflow-v2/stages/TakeoffStage.tsx` and `stages/assistant-logic.ts`
- Where they currently fetch `drawing_search_index` rows or call `extract-dimensions` on demand, **first** check `state.local.ocrCache` / `state.local.dimensionsCache`. If present and non-empty, use cached values; otherwise fall back to the existing fetch. Pure additive guard, no removal of existing logic.

### 5. Bust the cache on re-upload / re-index
- In `handleUpload` and `handleReindexAll`, before the loop, clear stale cached entries for files being replaced (`ocrCache[fileId]` set to undefined). After completion, re-run dimension extraction so the cache reflects the latest sheets.

## Out of scope
- No DB migrations.
- No edge-function changes (`extract-dimensions` already exists and writes `agent_knowledge` + `estimate_items.assumptions_json`).
- No UI redesign — only background pre-warming + cache reads.
- No changes to `WorkflowShell.tsx`, `ScopeStage`, `CalibrationStage`, or stage-gate logic.

## Risk
Low. Cache is additive: if it's missing or stale, existing fetch paths run unchanged. Dimension pre-extraction is fire-and-forget — failure does not block upload or navigation. localStorage size is bounded (text per page already <4KB after server cap; tens of pages at most).
