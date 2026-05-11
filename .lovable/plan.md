# Fix: Zoom + Pad-Footing Selection on the Takeoff Canvas

## Why nothing is selected today

The current overlay relies on `detectRegions()` (in `src/lib/region-segmentation.ts`), which only finds **already-colored fills** in the rendered raster. Construction sheets like the one in the screenshot are **black-and-white**, so detection returns zero regions → no pad footings are matched → no segment ever shows its colored box, and the fallback is just a full-page border.

The toolbar also has only Pan / Polygon / Erase + page nav — no zoom controls.

## What changes

### 1. Add zoom controls to the canvas toolbar

In `TakeoffCanvas.tsx`:
- Add `zoom` (default 1) and `pan` (`{x,y}`) state.
- New toolbar buttons under the existing tool stack: `+`, `−`, `Fit` (icons: `Plus`, `Minus`, `Maximize2`). Mouse-wheel + `Ctrl/Cmd` also zooms; double-click on Pan tool re-fits.
- Apply `transform: translate() scale()` on the image-box wrapper (the existing `imageBoxRef` div). Polygon clicks already use `getBoundingClientRect()` so normalized coords stay correct after zoom.
- Clamp zoom 0.5×–6×.

### 2. Replace color-detection highlighting with OCR-bbox highlighting

Drop reliance on `detectRegions` for the **selection highlight** (keep the file in place; it's still useful when a sheet does have colored fills, so we'll layer both: OCR-bbox first, then color regions as a backup).

New flow in `TakeoffCanvas.tsx`:
- When `highlight.label` or `layers` change, query `drawing_search_index` for OCR matches on the current `(source_file_id, page)`:
  - Match the layer's `name` and any short bar/footing marks it contains (`F1`, `WF-1`, `P3`, etc., parsed by a small regex helper).
  - Use existing `bbox_norm` (already normalized 0..1) to draw a colored rectangle per occurrence.
- Render a new SVG group `<g class="ocr-hits">` with one `<rect>` per hit:
  - Selected layer: `fillOpacity 0.45`, thick stroke, pulsing class.
  - Other visible layers: `fillOpacity 0.18`, thin stroke.
- The full-page border fallback only shows when neither OCR nor color regions match.

### 3. Small UX touches

- Layer-panel click on Pan tool now **selects + highlights** the layer (doesn't force Polygon mode) so user can browse segments without entering draw mode.
- Page nav respects zoom — switching pages resets zoom to fit.

## Files

- EDIT `src/components/takeoff-canvas/TakeoffCanvas.tsx` — zoom state/transform, zoom buttons, OCR-hit fetch + render, click-to-highlight on Pan.
- NEW `src/lib/ocr-hits.ts` — tiny helper: `fetchOcrHits(projectId, sourceFileId, page, queries) → { layerId, rects: BBoxNorm[] }[]` using `drawing_search_index`.
- No DB changes. No changes to `auto-segments`, `region-segmentation.ts`, `ScopeStage.tsx`, `Candidate` shape, or `takeoff_overlays`.

## Out of scope

- Auto-bar-schedule changes, segment inference, polygon-drawing UX changes other than the click-to-highlight tweak, multi-sheet batch highlighting, persisting OCR hits to DB.

## Verification

- B&W sheet with pad footings labeled `F1…Fn`: clicking "Pad Footings" in the scope panel paints a colored rectangle around every `F#` mark on the current page (matches the orange/teal reference).
- Sheet already colored (Togal export): color-region overlay still shows as today.
- `+` / `−` / wheel-zoom enlarge the sheet around the cursor; `Fit` restores. Polygon draw still lands on the right normalized coords after zoom.
- `bunx tsc --noEmit` passes; no console errors when `drawing_search_index` is empty for a project.
