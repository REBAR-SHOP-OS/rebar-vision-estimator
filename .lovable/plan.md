
## Show Element Markers on Drawing Even Without Spatial Data

### Problem
When the AI extracts elements from tabular data (schedules, notes) rather than from spatial regions on the drawing, the elements have no `bbox` coordinates. Currently this means:
- The Features panel shows elements correctly (F1, F2, SF1, etc.)
- But the drawing is completely raw -- no colored markers appear
- A "No spatial data" banner shows instead

### Solution
When elements lack bbox data, automatically assign them visible positions on the drawing so colored dots and labels still appear. This gives the user a visual reference on the drawing itself.

### How It Works

**File: `src/components/chat/ChatArea.tsx`**
- In the `overlayElements` memo, stop filtering out elements that lack `bbox`
- For elements without `tag_region.bbox`, generate fallback positions:
  - Group elements by type
  - Place them in a vertical list layout along the left margin of the drawing (offset ~80px from edge)
  - Space them vertically with ~60px gaps per element, grouped by type
  - Each gets a synthetic bbox of roughly [x, y, x+40, y+40] -- just enough to render a dot and label

**File: `src/components/chat/BlueprintViewer.tsx`**
- Remove the `hasOverlays` guard that hides the `DrawingOverlay` component when no valid bboxes exist
- Always render `DrawingOverlay` if there are any elements (even with synthetic positions)
- Update the "No spatial data" banner to say something like "Element positions are approximate -- parsed from tabular data" instead of hiding markers entirely

**File: `src/components/chat/DrawingOverlay.tsx`**
- No changes needed -- it already renders based on whatever elements are passed in with valid bbox dimensions

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/ChatArea.tsx` | In `overlayElements` memo: include elements without bbox by generating synthetic fallback positions based on image dimensions. Group by type and lay out vertically along the left side of the drawing. |
| `src/components/chat/BlueprintViewer.tsx` | Remove `hasOverlays` condition from DrawingOverlay rendering -- always show overlay if elements exist. Update the "No spatial data" banner text to indicate approximate positions. |

### Fallback Position Logic (in ChatArea.tsx)

```text
For each element without bbox:
  1. Group by element_type
  2. Starting position: x=80, y=80
  3. Each type group starts a new row block
  4. Within a group, elements are spaced 60px apart vertically
  5. Synthetic bbox = [x, y, x+40, y+40]
  6. If positions exceed image height, wrap to next column (x += 200)
```

This ensures every element in the Features panel also has a visible marker on the drawing, with colored dots and labels matching the panel.
