

## Fix: Empty Blueprint Viewer Overlays

### Problem
The AI model outputs `bbox: [0, 0, 0, 0]` for all elements because it doesn't have real pixel coordinates from the PDF text extraction. The overlay code at line 769 of `ChatArea.tsx` checks `if (el.regions?.tag_region?.bbox)` which is truthy for `[0,0,0,0]`, so elements are treated as having spatial data. But DrawingOverlay then filters them out since their dimensions are < 10px.

### Fix
In `ChatArea.tsx` line 769, add a check that the bbox has actual non-zero dimensions before treating it as spatial data:

```typescript
// Line 769 change:
const bbox = el.regions?.tag_region?.bbox;
const hasBbox = bbox && (bbox[2] - bbox[0]) > 10 && (bbox[3] - bbox[1]) > 10;
if (hasBbox) {
  withBbox.push({ ... });
} else {
  withoutBbox.push(el);
}
```

This ensures elements with placeholder `[0,0,0,0]` bboxes fall through to the synthetic position generator, which arranges them along the left margin grouped by type -- making them visible and clickable on the blueprint.

### Files to edit
1. `src/components/chat/ChatArea.tsx` -- fix bbox truthy check (lines 769-781)

