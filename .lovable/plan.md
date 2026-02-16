

## Make Element Overlays More Visible and Clear on the Drawing

### Problem
The current overlay rectangles are nearly invisible -- thin, low-opacity strokes that blend into the blueprint. Users can't easily tell what's being highlighted or where to look.

### Changes to `src/components/chat/DrawingOverlay.tsx`

**1. Bolder boxes with higher contrast**
- Increase default stroke width from 2 to 3, and selected/hovered even thicker (4-5)
- Increase fill opacity from 0.08 to 0.15 (default), 0.25 (hovered), 0.3 (selected)
- Add a white outer stroke (glow effect) behind the colored stroke for contrast against dark blueprints

**2. Add corner bracket markers instead of plain rectangles**
- Draw L-shaped corner brackets at each corner of the bounding box (like a camera viewfinder / targeting reticle)
- These are universally understood as "pointing at this area" markers
- Each corner gets a short line pair (e.g., 20px long) in the element's color with thicker stroke

**3. Improve the label tag**
- Make the label pill larger with more padding and bigger font (14px instead of 12px)
- Add a small downward-pointing triangle/arrow connecting the label to the box so it clearly "points" to the element
- Add a subtle drop shadow via SVG filter for readability on any background

**4. Add a pulsing dot at the center of selected/active elements**
- A small filled circle at the center of the bounding box that pulses, drawing the eye to the target

### Visual comparison

Before: Thin transparent rectangle, tiny label floating above
After: Bold corner brackets with glow, larger label with pointer arrow, pulsing center dot on selection

### Files Changed

| File | Change |
|---|---|
| `src/components/chat/DrawingOverlay.tsx` | Replace plain rect with corner-bracket markers, add glow filter, pointer arrow on label, pulsing center dot, increase all opacities and stroke widths |
| `src/index.css` | Add keyframe animation for the pulsing center dot (`@keyframes overlay-pulse`) |

