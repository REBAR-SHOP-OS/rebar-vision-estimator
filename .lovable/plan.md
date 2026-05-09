# Fix: QA pointer drifts when zooming / panning

## Root cause

In `src/features/workflow-v2/stages/QAStage.tsx`, the drawing image is wrapped in a div that gets a CSS `transform: translate(pan) scale(zoomLevel)`. But the `BBoxPointer` (orange selector box) and the debug text-line overlays are rendered **outside** that wrapper, positioned in raw canvas coordinates from `pageBox` (which is measured from the un-transformed image).

Result:
- At zoom = 1, pan = 0 → pointer happens to align.
- As soon as you zoom in/out or pan, the image moves via CSS transform but the pointer stays put → it drifts off the target.
- Additionally, `zoom` is being passed into `BBoxPointer` and `computeFocusTransformForImage`, double-counting the scale.

## Change (single file, minimal patch)

**File:** `src/features/workflow-v2/stages/QAStage.tsx`

1. **Move the overlay group inside the transform wrapper.** The block at lines ~785–802 that renders `<BBoxPointer …>` and the debug `textLines` markers must live inside the same `<div style={{ transform: translate+scale }}>` that wraps the `<img>`. The "approximate / unavailable" status badges and the bottom-right "Selected target" action bar (~803–830) stay outside (they should remain screen-fixed).

2. **Stop double-applying zoom in the pointer math.** Since the parent div now scales the pointer along with the image:
   - Pass `zoom={1}` to `BBoxPointer` (or drop the prop usage). Keep its internal `labelScale`/`borderPx` counter-scale, but base it on the actual `zoomLevel` so the badge/border don't visually balloon — pass `zoomLevel` as a separate `viewZoom` prop used only for visual compensation, not for positioning.
   - Remove the `computeFocusTransformForImage(...).scale` branch used to derive `zoom` for the pointer; pointer positioning no longer needs it.

3. **Keep `pageBox` as-is.** It already represents the image rect inside the wrapper at scale 1, which is exactly what we want now that the wrapper handles the scaling.

## Out of scope

- `qa-overlay-geometry.ts` math (still used for any future focus auto-centering).
- `PdfRenderer`, page text extraction, issue list, side panel.
- Pan/zoom toolbar behavior (already working).

## Verification

- Select a QA issue → orange pointer appears on the target.
- Zoom in / out → pointer stays glued to the same drawing feature.
- Pan with the hand tool → pointer moves with the drawing.
- Reset (Maximize2) → pointer returns to original position aligned with target.
- Border thickness and the small "!" badge stay visually reasonable at all zoom levels.
