# Stage 02 — Auto-Detected Segments + Selected Segment Highlight on Blueprint

**Goal:** Match the attached design. The left sidebar of Stage 02 (Scope Review) shows the auto-detected segments as soon as the project opens. Clicking a segment in the list highlights that exact area on the blueprint on the right with an orange `SELECTION: <label>` overlay (like the reference screens).

Today the left column already lists candidates (after `auto-segments` finishes), but the right canvas only paints layers from *approved* items and never visually highlights the *selected* candidate, so estimators can't see what they're looking at on the drawing. The user's screenshot also shows the list stuck on "DETECTING SCOPE…" with no recovery path.

## What changes (minimal patch, UI-only on the client)

```text
┌──────────────────┬──┬───────────────────────────────────────┐
│ Candidate Scope  │▮ │  Takeoff Canvas (right pane)          │
│ ───────────────  │▮ │  ┌─────────────────────────────────┐  │
│ ▣ FTG-1  92%     │▮ │  │ blueprint page (from PDF)       │  │
│ ▣ COL-A  88%     │▮ │  │     ┌──── SELECTION: FTG-1 ───┐ │  │
│ ▢ SLAB-2 81% ←sel│▮ │  │     │ orange dashed bbox      │ │  │
│ ▢ WALL-3 76%     │▮ │  │     └─────────────────────────┘ │  │
└──────────────────┴──┴───────────────────────────────────────┘
```

### 1. `supabase/functions/auto-segments/index.ts`
Return, for each suggestion, the best supporting evidence from `drawing_search_index`:
- `page_number` (int)
- `bbox`: `[x, y, w, h]` normalised to `0..1` on that page (use the matching word/phrase bbox already produced by Vision OCR; if multiple matches, use the largest)
- `source_file_id` (project_files id) so the canvas can swap to the right PDF

Backwards-compatible: existing `{ name, segment_type, notes }` keys are preserved.

### 2. `src/features/workflow-v2/stages/ScopeStage.tsx`
- Map the new fields into `Candidate` (add `pageNumber?`, `bbox?`, `sourceFileId?`).
- Pass a new `highlight` prop to `<TakeoffCanvas/>` built from the **selected** candidate (not the approved set):
  ```ts
  highlight={sel ? { label: sel.label, pageNumber: sel.pageNumber ?? 1,
                     bbox: sel.bbox, color: "hsl(24 95% 55%)" } : undefined}
  ```
- Replace the indefinite "Detecting scope…" empty-state with a 30 s watchdog: if `auto-segments` returns no rows or times out, surface a "No candidates detected" message with a **Retry** button that re-invokes the edge function.

### 3. `src/components/takeoff-canvas/TakeoffCanvas.tsx`
Add optional prop:
```ts
highlight?: { label: string; pageNumber: number; bbox?: [number,number,number,number]; color?: string };
```
Behaviour:
- When `highlight.pageNumber` differs from current page, auto-jump to that page (`setPage`).
- Render a non-interactive SVG overlay above the existing layers SVG:
  - If `bbox` present → orange dashed rectangle at the normalised coords, with a small filled tag `SELECTION: <label>` anchored top-left of the rect (matches the design).
  - If `bbox` missing → render the tag at the top-center of the page so the user still sees which candidate is active.
- The selection overlay is purely cosmetic — it does not write `manual_polygons` or affect approval state.

### 4. No DB schema changes
We read existing `drawing_search_index` bbox data that OCR already stores. No new tables, no new RLS.

## Out of scope

- Editing/dragging the selection rect (read-only highlight only).
- Calibration of px/ft (Stage 03 already handles that).
- Backend rewrites of `auto-segments` beyond returning the existing bbox/page evidence.
- `TakeoffStage`, `CalibrationStage`, `PdfRenderer` — untouched.

## Verification

1. Open a project with parsed drawings → Stage 02 left list populates within a few seconds.
2. Click each candidate → right pane jumps to the right PDF page and draws an orange `SELECTION: <label>` box.
3. If a candidate has no bbox (older projects), the page still switches and a tag still shows.
4. Force `auto-segments` to fail → left column shows "No candidates detected" + Retry button instead of hanging.
5. Re-run `npm run test` to ensure existing scope/stage tests still pass.
