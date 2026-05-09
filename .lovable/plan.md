# Fix QA overlay zoom/pan controls

## Problem

In `src/features/workflow-v2/stages/QAStage.tsx`, the toolbar buttons (ZoomIn / ZoomOut / Maximize2 / Hand) update `zoomLevel` and `pan` state, but **nothing actually applies them to the rendered drawing**. The `<img>` for both the PDF page and the raster preview is rendered with only `className="max-w-full max-h-full object-contain"` — no `transform`, no drag handlers, no wheel handler. So clicking zoom in/out does nothing visible, and there is no hand tool to pan.

`zoomLevel` is only consumed by `BBoxPointer` for the focus highlight, never by the image itself.

## Fix (minimal patch, single file: `QAStage.tsx`)

1. **Apply transform to the drawing layer.** Wrap the existing PDF `<img>` and raster `<img>` blocks (lines 705–725 and 727–747) in a positioned div with:
   ```
   transform: `translate(${pan.dx}px, ${pan.dy}px) scale(${zoomLevel})`
   transformOrigin: 'center center'
   transition: isPanning ? 'none' : 'transform 120ms ease-out'
   ```
   Image keeps `object-contain` so the base fit is unchanged at `zoomLevel=1, pan=0,0`.

2. **Add a Hand / pan tool button** to the toolbar row (after the Maximize2 button, before Bug). New local state `tool: 'select' | 'pan'`. Icon: `Hand` from lucide-react.

3. **Drag-to-pan on the canvas container** (`canvasRef` div, line 681). Add `onMouseDown / onMouseMove / onMouseUp / onMouseLeave` handlers that:
   - Activate when `tool === 'pan'` OR when middle-mouse / space-held drag.
   - Track start pos + start pan, update `pan` on move.
   - Switch cursor to `grab` / `grabbing` when pan tool is active.

4. **Wheel-to-zoom** on the canvas container: `onWheel` with `preventDefault`, adjusts `zoomLevel` between 0.5 and 4 in 0.1 steps based on `deltaY` sign. Ctrl+wheel only, to avoid hijacking page scroll.

5. **Reset behavior.** The Maximize2 (tight/full) button additionally resets `zoomLevel=1` and `pan={dx:0,dy:0}` so users can recover from a zoomed/panned state. Existing `useEffect` on `sel?.id` (line 252) already resets these on issue change — keep as-is.

6. **Keep BBoxPointer correct.** It currently receives `zoom = computeFocusTransformForImage(...)` which already factors in `zoomLevel` and `pan`. Since we're now also transforming the underlying image with the same `zoomLevel`/`pan`, the pointer should follow naturally because it's positioned relative to `pageBox` inside the same `canvasRef` container — verify by leaving the pointer rendering inside the new transformed wrapper so it scales/translates with the image. Move the `BBoxPointer` and the debug text-line overlays into the transformed wrapper, while keeping the badges (anchor status, selected-target action card) outside it (they should stay screen-fixed).

## Out of scope

- No changes to `qa-overlay-geometry.ts`, `PdfRenderer`, or any other stage.
- No keyboard shortcuts beyond optional space-to-pan (skip if it complicates focus handling).
- No touch/pinch gestures.

## Verification

- Click ZoomIn/ZoomOut → drawing visibly scales, footer "Zoom: NNN%" updates.
- Click Hand → cursor becomes grab; drag moves the drawing; release stops.
- Click Maximize2 → resets zoom/pan and toggles tight/full mode.
- BBoxPointer stays anchored to the same drawing feature while zooming/panning.
