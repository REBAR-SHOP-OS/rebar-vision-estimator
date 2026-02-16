

## Improve Overlay Markers to Match Takeoff-Style Colored Dots

### What Changes
The reference image shows a professional takeoff tool where each element is marked with a **bold colored dot/pin** at its center -- simple, clean, and instantly recognizable. Our current overlay uses corner brackets and filled rectangles that clutter the drawing and are hard to parse at a glance.

### New Visual Style
- **Always-visible colored dot** at the center of every element (radius ~10px, with white border for contrast)
- **Light shaded rectangle** kept but made more subtle (lower opacity) -- just to show the element's area
- **Label only appears on hover or selection** instead of always showing -- reduces clutter dramatically
- **Corner brackets kept but thinner** as a subtle boundary indicator, not the primary visual
- Selected/hovered elements get a **larger dot with pulse animation** and the label becomes visible

### Summary of Changes

| Visual Element | Before | After |
|---|---|---|
| Primary marker | Corner brackets (hard to see) | Bold colored dot at center (like reference) |
| Label | Always visible on every element | Only shown on hover or selection |
| Area highlight | Always visible fill | Lighter default, stronger on hover |
| Corner brackets | Thick, primary visual | Thinner, secondary visual |
| Selected state | Pulsing center dot | Larger dot + label appears + pulse |

### Technical Details

**File: `src/components/chat/DrawingOverlay.tsx`**

1. Add a prominent **colored circle** (r=10, white stroke r=2) at center (cx, cy) for every element -- always visible
2. On hover/select, increase dot radius to 14 and show the label group
3. Wrap the label `<g>` in a conditional: only render when `isSelected || isHovered || isActive`
4. Reduce default corner bracket stroke width from 3 to 2, and fill opacity from 0.12 to 0.06
5. On hover, bump fill opacity to 0.15 and corner stroke to 2.5; on select, 0.2 and 3

**File: `src/index.css`**
- No changes needed -- existing pulse animation already covers the dot

