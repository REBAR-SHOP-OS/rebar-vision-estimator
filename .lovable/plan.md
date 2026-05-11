
## Goal

When the sheet is shown in `TakeoffCanvas`, automatically detect Togal-style colored regions on the rendered page image and overlay a polygon for **every** candidate. The selected candidate's polygon glows; the others stay dim. Today the highlight is a border around the whole page — this scopes it to the actual segment region.

## Approach: client-side color-region detection

The PDF page is already rasterized to an `<img>` (`pdfImg`) inside `TakeoffCanvas.tsx`. We will run a lightweight color-segmentation pass on that image in the browser, then store the resulting polygons + their dominant color per page. No edge function changes, no DB schema changes.

Algorithm (in a new `src/lib/region-segmentation.ts`):

1. Draw the rendered page to an offscreen `<canvas>` at ~1024px wide (downsample for speed).
2. Read pixels. Filter out near-white (background) and near-black (linework/text) by luminance + saturation thresholds, leaving only the colored fill regions.
3. Quantize each remaining pixel's color to a small palette (HSV hue buckets — ~12 bins).
4. Run connected-component labeling per hue-bucket → list of blobs with `{ bucketHueDeg, pixelCount, bboxPx, contourPolygonNormalized }`.
5. Reject blobs smaller than ~0.2% of page area (noise). Trace the outer contour with a Moore-neighbor walk and Douglas–Peucker simplify to ≤40 points. Output normalized 0..1 coordinates so it works with the existing SVG viewBox `0 0 1 1`.
6. Return `Region[] = { id, color, polygon: [x,y][], areaPct, bboxNorm, centroidNorm }`.

This runs once per `(filePath, page)` after `pdfImg` and `imgSize` are set, cached in a `useRef` map. Time budget: <500ms for a 2K page on a modern laptop; runs off the main paint via `requestIdleCallback` fallback to `setTimeout(0)`.

## Mapping regions → candidates

Inside `TakeoffCanvas`, after regions are computed we assign each layer/candidate a region:

- Each `CanvasLayer` already has a deterministic color from `colorForSegmentType(segment_type)`. Match a region to the layer whose color is closest in hue (`Δhue < 25°`). If multiple regions tie for the same layer, keep all of them.
- Any region not matched to a layer is rendered as a neutral "other region" with low opacity (so users still see the segmentation worked).
- If the page has no colored regions (e.g. structural B/W drawings), gracefully fall back to the current full-page highlight behavior — no error.

## Rendering changes in `TakeoffCanvas.tsx`

Inside the existing SVG (lines ~348–404), add a new group **before** the saved manual polygons:

```text
<g class="auto-regions" pointer-events="none">
  for each region:
    <polygon points="..." fill={layerColor} fillOpacity={isHighlighted ? 0.55 : 0.18}
             stroke={layerColor} strokeWidth={isHighlighted ? 0.008 : 0.003} />
</g>
```

`isHighlighted` is true when `highlight?.label` matches that region's layer name (case-insensitive). The existing full-page inset border (lines 405–421) becomes a fallback: only render it when no region matched the current selection.

Hook addition near the top of the component:

```text
const [regions, setRegions] = useState<Region[]>([]);
useEffect(() => {
  if (!pdfImg || !imgSize) return;
  let alive = true;
  detectRegions(pdfImg, { maxDim: 1024 }).then(r => alive && setRegions(r));
  return () => { alive = false; };
}, [pdfImg, imgSize?.w, imgSize?.h]);
```

## Files touched

- **NEW** `src/lib/region-segmentation.ts` — pure helper: `detectRegions(imageUrl, opts): Promise<Region[]>`. No React, no Supabase.
- **EDIT** `src/components/takeoff-canvas/TakeoffCanvas.tsx` — add `regions` state + effect, render the new `<g class="auto-regions">` group, keep the existing border as fallback. ~40 lines.

No changes to: `ScopeStage.tsx`, `auto-segments` edge function, DB schema, `Candidate` shape, `takeoff_overlays` table.

## Out of scope

- OCR-based label→region binding (would need spatial OCR plumbing).
- Persisting detected regions in the DB.
- Editing/refining detected regions in the UI.
- Multi-page batch detection — only the currently-viewed page runs.
- Performance heroics for very large pages beyond the 1024px downsample.

## Verification

- Open a colorful floor plan (e.g. the Togal-style reference) → each colored room gets an overlay polygon, the selected candidate's polygon is brighter than the rest.
- Open a black-and-white structural drawing → no regions, current full-page highlight still works.
- `bunx tsc --noEmit` passes.
- No console errors; selecting candidates does not cause re-detection (cache by `pdfImg` URL).
