
## Problem

In `src/components/takeoff-canvas/TakeoffCanvas.tsx`:

- The `<img>` uses `object-contain` and shrinks to fit, but the `<svg>` overlay is `absolute inset-0` over the **whole stage container**. So a polygon stored as `(0..1, 0..1)` of the image is painted as `(0..1, 0..1)` of the entire (much larger) stage — making it land far from the drawing, often off-screen.
- During drawing, click coordinates are also normalised against the stage rect, not the image rect — so the points you click and the saved polygon do not correspond to the same place on the sheet.
- The image visually pins to the bottom because the centering wrapper is fighting the headless `PdfRenderer` slot above it; the image is centered inside a too-tall flex column.

Both symptoms ("no overlay visible" + "image stuck at the bottom") come from the same root cause: the stage doesn't track the actual image bounds.

## Fix (single file: `src/components/takeoff-canvas/TakeoffCanvas.tsx`)

1. Introduce an **image-bound wrapper** that the `<img>` and `<svg>` both live inside, sized to the image's natural aspect ratio:
   - Compute aspect ratio from `imgSize` (`w/h`).
   - Wrapper uses `max-h-full max-w-full` with `aspectRatio: w/h` so it matches the rendered image rect exactly.
   - `<img>` becomes `h-full w-full object-contain` (or `object-fill` since the box already matches the aspect).
   - `<svg>` is `absolute inset-0` of this wrapper — now `viewBox="0 0 1 1"` truly maps to the visible image.

2. Update `onStageClick` to normalize against the **image wrapper**'s rect (new ref `imageBoxRef`), not the outer stage. Reject clicks that fall outside the image box.

3. Centering: keep the outer flex `items-center justify-center`, but remove the extra nested `flex` wrapper that was making the image cling to the bottom. The aspect-ratio box will naturally center.

4. Make sure the `PdfRenderer` stays headless (it already is — no visible output). No layout slot for it in the stage.

5. Small polish: when `imgSize` updates from either the PDF render callback or the `<img onLoad>`, prefer the rendered image's natural size (already handled), but reset `imgSize` on page change so the wrapper resizes correctly between sheets of different aspect ratios.

## Out of scope

- No DB, RLS, edge function, or schema changes.
- No changes to layer panel, toolbar, sidebar, or stage picker.
- No changes to polygon storage format (still `[[x,y], ...]` normalized 0..1 of the image).

## Verification

- Open `/app/project/.../` → Takeoff stage on a multi-page PDF.
- Image should center in the available canvas area (no large empty band above it).
- Pick a layer (e.g. Piers) → tool auto-switches to polygon → click 4 points around a feature → double-click to close.
- Polygon should appear exactly where you clicked, in the layer's color, and persist after page navigation away and back.
- Erase tool should hit-test the polygon correctly.

