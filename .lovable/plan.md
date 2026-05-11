## Goal

When the user (a) switches the selected scope candidate or (b) navigates to a new page, the canvas should automatically run OCR and automatically light up the layer(s) that match the selection — so picking "Elevated Slabs (per level)" instantly highlights the actual slab marks (S-1, S1, etc.) on the current sheet.

## Current behavior (what's wrong)

In `src/components/takeoff-canvas/TakeoffCanvas.tsx`:

1. OCR auto-runs **only** when `highlight.label` is set AND the page has no cache. It does **not** re-run on plain page changes (next/prev sheet) even if a scope is still selected.
2. When OCR returns hits, every matching layer is drawn — there is no visual emphasis on the *selected* candidate. The user picked "Elevated Slabs", but footings, walls, columns, etc. are all painted at equal weight, so the slab match is lost in the noise.
3. `hitsByLayer` maps an OCR token to a layer by exact `segment_type` bucket. "Elevated Slabs (per level)" infers to `slab`, and `S-1` also maps to `slab`, so the match exists — but only as one of many overlays, with no zoom/jump to the matched rect.

## Plan (single file: `src/components/takeoff-canvas/TakeoffCanvas.tsx`)

### 1. Auto-OCR on page change too

Extend the existing auto-OCR effect (around line 417) so it fires when **either** the highlight or the page changes, as long as a candidate is currently selected:

```text
useEffect(() => {
  if (!ocrCacheKey) return;
  if (ocrCacheRef.current.has(ocrCacheKey)) return;
  if (ocrLoading) return;
  // Run when a scope is selected (highlight) OR the page just changed
  // and we have a usable source URL.
  if (!highlight?.label && !pdfImg && !signedUrl) return;
  runOcr();
}, [highlight?.label, page, ocrCacheKey, runOcr, ocrLoading, pdfImg, signedUrl]);
```

This means: pick a candidate → OCR runs; flip to next page → OCR runs again automatically (cached after first time).

### 2. Compute the "selected layer" from `highlight.label`

Add a memo that resolves the candidate name → matching layer in the panel:

```text
const selectedLayer = useMemo(() => {
  if (!highlight?.label) return null;
  const want = highlight.label.trim().toLowerCase();
  return (
    layers.find((l) => l.name.trim().toLowerCase() === want) ||
    layers.find((l) => (l.segment_type || inferSegmentType(l.name)) ===
                       inferSegmentType(highlight.label!)) ||
    null
  );
}, [layers, highlight?.label]);
```

### 3. Emphasize the selected layer visually

Where OCR hit rectangles are rendered (the block that consumes `hitsByLayer`), branch on `selectedLayer`:

- Hits belonging to `selectedLayer.id` → draw at full opacity, thicker stroke, with a soft pulse class (reuse `.overlay-pulse` already used in `DrawingOverlay`), and use the layer color.
- Hits for other layers → draw at low opacity (≈ 0.25) with a thin stroke, no pulse.

If `selectedLayer` is null (no candidate chosen) keep current rendering for all hits.

### 4. Auto-fit zoom/pan to the matched hits (best-effort)

After OCR finishes and `selectedLayer` is set, if there are hits for that layer, compute their union bbox in normalised coords and:

- If `fittedBox` and `stageSize` exist, set `zoom` to a value that frames the union bbox with ~20% padding (cap at `clampZoom` bounds), and set `pan` so the bbox center lands in the stage center.
- Skip if the user has manually zoomed (track a `userZoomedRef` flag set in `onWheel` / `zoomIn` / `zoomOut`; cleared on page or highlight change).

This is what makes "I chose Elevated Slab → I see the exact slab segments framed on the sheet" work.

### 5. No changes outside this file

- `ocr-page-labels.ts`, `region-segmentation.ts`, the `ocr-image` edge function, `ScopeStage`, DB tables, RLS — all untouched.
- No new dependencies.
- `bunx tsc --noEmit` must remain clean.

## Out of scope

- Adding new OCR mark patterns (the dot/hyphen variants are already in place from the previous patch).
- Persisting any selection — purely cosmetic / UX.
- Region-based fallback when OCR returns zero hits (separate change, will revisit only if user asks).

## Acceptance

- Pick "Elevated Slabs (per level)" → OCR runs → slab marks (S-1 / S1 / S.1) on the current sheet are highlighted in the slab color and pulsing; other layers fade.
- Click ▶ to next page → OCR runs automatically; same emphasis applied.
- Pick a different candidate (e.g. "Wall Footings (WF)") → emphasis instantly shifts to WF marks; no manual ✨ click required.
- No OCR re-run when revisiting a page already cached.
