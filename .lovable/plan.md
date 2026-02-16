

## Fix Misleading "Click any box" Guidance

### Problem
The blueprint viewer says "Click any box to see details" and shows a legend with "PIER -- 2 found", but no colored boxes are actually visible on the drawing. This happens because the elements were extracted from a tabular bar list, where bounding boxes are rough row-position estimates (often just thin horizontal lines with near-zero height). The current `hasOverlays` check uses OR logic (`bbox[2] > bbox[0] || bbox[3] > bbox[1]`), so these thin bands pass the check even though they're not meaningfully visible.

### Changes

**1. Fix the `hasOverlays` check to require meaningful boxes**

Change the OR to AND, and add a minimum size threshold so only boxes with real width AND height count as visible overlays:

```
// Before (too lenient)
el.bbox[2] > el.bbox[0] || el.bbox[3] > el.bbox[1]

// After (requires real rectangles)
(el.bbox[2] - el.bbox[0]) > 10 && (el.bbox[3] - el.bbox[1]) > 10
```

This means thin row-bands from tabular extraction won't trigger the "click any box" messaging.

**2. When boxes aren't meaningful, show the "No spatial data" notice instead**

The existing "No spatial data -- elements were parsed from tabular data" notice already exists for the `!hasOverlays` case. With the stricter check, tabular-only elements will correctly show this notice instead of the misleading "click any box" banner.

**3. Also fix the same OR condition in `DrawingOverlay.tsx` filter**

The DrawingOverlay component filters elements using the same lenient OR check. Update it to match the stricter AND logic so it doesn't try to render invisible rectangles.

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/BlueprintViewer.tsx` (line 159) | Change `hasOverlays` to require both width AND height > 10px minimum |
| `src/components/chat/DrawingOverlay.tsx` (line 64) | Update the filter to also require both width AND height > 10px |

