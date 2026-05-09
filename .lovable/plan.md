# Fix: QA pointer wrong at 100% AND drifts on zoom/pan

## Root cause

The current code positions `BBoxPointer` using a JS-measured `pageBox` (derived from `parent.clientWidth/clientHeight` + `object-contain` math). This is fragile:

- `clientWidth` of the flex parent is not always exactly the image's rendered box, especially with the new transform wrapper, scrollbar gutters, or before fonts/layout settle.
- `updatePageBox` runs on image load + ResizeObserver, but not when intermediate state (e.g. PDF re-render swapping the img element) changes.
- Even a 2–5 px offset at zoom 1 becomes an obvious miss after zooming 2–4×.

Result: pointer is wrong even at 100% and drifts further when zooming.

## Fix (single file, minimal patch)

**File:** `src/features/workflow-v2/stages/QAStage.tsx`

Replace the JS-measured `pageBox` plumbing with **CSS-anchored** positioning that is mathematically guaranteed to match the rendered image.

### 1. Wrap the `<img>` in an inline-block "image-fit" container

For both the PDF branch and the raster branch, change:

```text
<div absolute inset-0 flex items-center justify-center>
  <img ... className="max-w-full max-h-full object-contain" />
</div>
```

to:

```text
<div absolute inset-0 flex items-center justify-center>
  <div className="relative" style={{ display: "inline-block", maxWidth: "100%", maxHeight: "100%" }}>
    <img ... className="block max-w-full max-h-full object-contain" />
    {/* BBoxPointer + debug textLines render here, as siblings of the <img> */}
  </div>
</div>
```

Because the wrapper is `inline-block` with `max-w/max-h: 100%` and the `<img>` uses `max-w-full max-h-full`, the wrapper auto-sizes to **exactly** the image's rendered box. Percentage offsets inside the wrapper are now percentages of the image itself — no JS measurement needed.

### 2. Move the overlay group inside the new wrapper

Move the existing overlay block (lines ~772–788) into the new image-fit wrapper — there is now **one** wrapper per branch, so render the overlays once per branch (PDF and raster). Both branches feed the same `BBoxPointer` props.

### 3. Update `BBoxPointer` to position by % only

Drop `pageBox`, `imgW`, `imgH` reliance for positioning. New props/usage:

```text
BBoxPointer({ bbox, imgW, imgH, viewZoom, title, onFix, approximate })
  left   = `${(bbox[0]/imgW)*100}%`
  top    = `${(bbox[1]/imgH)*100}%`
  width  = `${((bbox[2]-bbox[0])/imgW)*100}%`
  height = `${((bbox[3]-bbox[1])/imgH)*100}%`
```

Keep `viewZoom` for visual stability (border, halo, badge counter-scale). Remove the `zoom` positioning prop entirely.

### 4. Remove now-dead pageBox logic

- `pageBox` state, `updatePageBox`, the ResizeObserver tied to it, and `pageBox` passed into `canShowPointer` can stay if other code reads them, but the pointer must no longer depend on them. Simplest: keep `pageBox` only if still referenced; otherwise delete `updatePageBox` calls in `onLoad`.
- Update `canShowPointer` to: `renderStatus === "ready" && previewUrl && imgSize && bbox` (no pageBox dependency).
- Debug `textLines` markers (also previously using `pageBox`) move into the wrapper too, using `top: ${(line.y/imgSize.h)*100}%; left: 0; right: 0;`.

### 5. Keep transform wrapper as-is

The outer `transform: translate(pan) scale(zoomLevel)` div is unchanged. Because the image-fit wrapper and overlays are inside it, pan/zoom transform them together → pointer stays glued at any zoom.

## Why this works at any zoom

- At zoom 1: wrapper === image rect (CSS guarantee), so 50% left really is the image's horizontal center. No measurement error.
- At zoom N: parent transform scales wrapper + overlays identically about the same origin → relative positions preserved exactly.
- No timing issues: no need to wait for `onLoad` + ResizeObserver to converge before the pointer is placed.

## Out of scope

- `qa-overlay-geometry.ts` (still used for any future focus auto-centering math).
- `PdfRenderer`, page text extraction, issue list, side panel, status banners, action bar.
- Pan/zoom toolbar behavior and Maximize2 reset (already correct).

## Verification

1. Load a QA issue → orange pointer is on the target at 100%.
2. Zoom in to 4× → pointer stays exactly on the same drawing feature.
3. Pan with hand tool → pointer moves with the drawing.
4. Switch issues / pages → pointer reattaches correctly each time.
5. Border thickness and "!" / "≈" badge stay visually reasonable at all zoom levels.
6. Resize the window → pointer stays aligned (no `updatePageBox` race needed).
