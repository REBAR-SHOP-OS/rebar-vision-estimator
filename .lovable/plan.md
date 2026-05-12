# Fix: Takeoff Canvas overlay no longer marking (manual draws + OCR labels)

## Goal
Restore visible overlays in `TakeoffCanvas.tsx`:
1. Manual tools (Polygon / Square / Circle) once again paint a colored shape on the active layer when the user clicks the sheet.
2. Auto-detect labels (Sparkles) once again paints colored rectangles on detected structural marks.

## Root causes (most likely)

1. **`activeLayer` is initialized once from `layers[0]?.id || null` (line 63) and never resynced.** When `layers` arrives async or changes after mount, `activeLayer` stays `null`. With `activeLayer === null`:
   - `onStageClick` (line 306) early-returns → square/circle/polygon clicks do nothing.
   - The active-layer chip (line 685) never appears, so the user has no idea no layer is selected.
   - `saveOverlayPolygon` early-returns (line 270).

2. **OCR hits → layer bucket matching is too strict** (line 567):
   ```ts
   const layer = visibleLayers.find(
     (l) => (l.segment_type || inferSegmentType(l.name)).toLowerCase() === bucket
   );
   ```
   `markBucket` returns lowercase strings like `"wall" | "footing" | "pier" | "column"`, while `segment_type` / `inferSegmentType` typically return uppercase enum-like strings (`COLUMN`, `FOOTING`, …). The `.toLowerCase()` is on the layer side only; if the bucket is `"wall"` and the layer is `"WALL"`, after lowercasing we get `"wall" === "wall"` ✓ — but if bucket is `"column"` and layer.segment_type is `"COLUMN_PIER"` or similar, no match → no rectangle is drawn even though OCR returned hits.

3. **No user feedback on a no-op click.** Combined with (1), the user sees nothing happen and concludes "overlay is broken".

## Patch (single file: `src/components/takeoff-canvas/TakeoffCanvas.tsx`)

1. **Sync `activeLayer` with `layers` prop.** Add a small effect:
   ```ts
   useEffect(() => {
     if (layers.length === 0) { setActiveLayer(null); return; }
     setActiveLayer((cur) => (cur && layers.some((l) => l.id === cur)) ? cur : layers[0].id);
   }, [layers]);
   ```

2. **Make `onStageClick` give feedback when no active layer is selected** (so the user sees why nothing happened):
   ```ts
   if (tool !== "pan" && tool !== "erase" && !activeLayer) {
     toast.info("Pick a layer in the right panel first.");
     return;
   }
   ```

3. **Loosen OCR-hit → layer matching** in `hitsByLayer` (line 561). Match by either the raw layer name OR any segment_type whose lowercase contains the bucket token, so e.g. bucket `"column"` matches a layer with `segment_type` `"COLUMN_PIER"`:
   ```ts
   const layer = visibleLayers.find((l) => {
     const t = (l.segment_type || inferSegmentType(l.name) || "").toLowerCase();
     const n = l.name.trim().toLowerCase();
     return t === bucket || t.includes(bucket) || n.includes(bucket);
   });
   ```

4. **No other behavior changes.** Undo/Redo, drawing geometry, region detection, zoom/pan, and storage paths are untouched. No DB/schema changes.

## Verification

- Open a project with at least one segment / layer. Confirm the active-layer chip appears the moment you switch to Polygon / Square / Circle.
- Click the page with Square tool → a colored square is saved and rendered (and an entry pushes onto undo stack).
- Click Sparkles. After OCR completes, colored rectangles appear over `F.3 / WF-2A / P1 / C-9`-style marks for layers whose segment_type loosely matches.
- With no layer selected (empty project), clicking with a draw tool now shows an informative toast instead of silently doing nothing.

## Risks
- The looser bucket match could in theory map a label to a wrong layer when two layers share a substring (e.g. "RETAINING_WALL" and "ICF_WALL" both match `"wall"`). Acceptable: previous behavior was already to map all wall marks to the single matching wall layer, and `find` returns the first match.

## Out of scope
- Persisting undo/redo history.
- Refactoring `TakeoffCanvas`.
- Changing `markBucket` / OCR detection itself.
