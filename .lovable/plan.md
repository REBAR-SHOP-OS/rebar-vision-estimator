## Problem

On the Takeoff Canvas (Stage 03):
1. The **Hand / Pan** tool does nothing — there's `pan` state and a CSS `translate()` transform on the image box, but no mouse-drag handlers, so clicking the hand icon never moves the sheet.
2. Selecting **Pad Footings (F-pads)** (or any candidate) shows no colored boxes around the F1/F2/… marks. The sheet is a B&W PDF, so color-region detection returns nothing. OCR-based label detection exists but is (a) only triggered manually via the ✨ button, and (b) hard-gated off for PDFs because Google Vision needs a fetchable URL, not a blob.

## Fix

### 1. Pan tool — add real drag

In `src/components/takeoff-canvas/TakeoffCanvas.tsx`:

- Add `panningRef` (start `{x,y}` + initial pan) and `mousedown` / `mousemove` / `mouseup` / `mouseleave` handlers on the stage `<div ref={stageRef}>`.
- Active only when `tool === "pan"`. Updates `pan` state which already feeds the `transform: translate(...) scale(...)` on `imageBoxRef`.
- Cursor: `grab` when pan tool selected, `grabbing` while dragging.
- Keep `Ctrl/Cmd + wheel` zoom, plus add plain mouse-wheel pan when zoomed > 1 (optional, low risk).
- Reset `pan` on Fit (already there).

### 2. Auto-highlight footings — add PDF OCR path

OCR via `ocr-image` needs a publicly fetchable URL. PDFs render in the browser to a blob URL Vision can't fetch. Solution: upload the rendered page once to Storage and OCR the signed URL.

In `TakeoffCanvas.tsx`:

- In `runOcr`, when `isPdf && pdfImg`, fetch the blob, upload it to `blueprints` bucket at `${user.id}/${projectId}/pages/${sourceFileId || "sheet"}-p${page}.png` (RLS-safe path per project memory), `createSignedUrl`, and pass that URL to `detectPageLabels`. Cache the result in `ocrCacheRef` keyed by `${pdfImg}::${page}` so we only do it once per page-render.
- Drop the `toast.info("…available on image sheets…")` early-return for PDFs.
- **Auto-trigger** OCR when a `highlight` is set and we don't yet have hits for this page (small `useEffect` watching `highlight?.label`, `ocrCacheKey`, `pdfImg`/`signedUrl`). Show a subtle "Detecting marks…" spinner state on the ✨ button (already wired).
- Keep current rendering: `hitsByLayer` already maps OCR marks (`F1`, `WF-1`, `P3`, …) to layers via `markBucket` and draws colored rectangles around each occurrence, with the selected candidate's layer at higher opacity.

## Files

- EDIT `src/components/takeoff-canvas/TakeoffCanvas.tsx` only.

## Out of scope

- No DB/schema changes.
- No changes to `ocr-page-labels.ts`, `region-segmentation.ts`, `ocr-image` edge function, candidate logic, or `auto-segments`.
- No new bucket; reuses existing `blueprints` with the project-memory RLS path convention.
- No changes to ScopeStage or layer-panel logic beyond what's described.

## Verification

- B&W foundation PDF (e.g. CRU-1 S-1.0): clicking Pan + dragging moves the sheet when zoomed in. Selecting "Pad Footings (F-pads)" auto-runs OCR on the rendered page and shows orange boxes around every `F#` / `WF-#` mark, matching the Togal-style reference.
- Already-colored image sheets keep working (color-region path unchanged).
- `bunx tsc --noEmit` clean. No console errors when OCR returns 0 hits.
