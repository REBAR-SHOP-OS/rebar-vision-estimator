

## Plan: Fix Overlay Visibility — Reduce Marker Sizes and Show Labels on Hover Only

### Problem
The screenshot shows dots, labels, and corner brackets are massively oversized relative to the drawing, causing elements to overlap and obscure the blueprint entirely. The root cause is that all sizes (dot radius 16-20px, label font 13-15px, corner length 20px, stroke widths 2-3px) are fixed in SVG viewBox coordinates which map to the full image resolution (often 3000+ pixels), making them appear enormous.

Additionally, labels are always visible for every element, creating a wall of overlapping colored rectangles.

### Changes (single file: `DrawingOverlay.tsx`)

1. **Scale markers to image size** — compute a scale factor from `imageWidth` so sizes adapt:
   - Dot radius: 4-6 (down from 16-20)
   - Corner length: 8 (down from 20)
   - Stroke widths: 1-1.5 (down from 2-3)
   - Label font: 8-10 (down from 13-15)
   - Label height: 14 (down from 24)

2. **Labels only on hover/select/active** — hide the label `<g>` unless `isHovered || isSelected || isActive`, so the drawing stays clean at rest.

3. **Reduce dot white stroke** — from 3 to 1.5 so dots don't bleed.

4. **Reduce fill opacity** — default fill from 0.06 to 0.03 so bboxes don't tint the drawing.

### Scope
- 1 file modified: `src/components/chat/DrawingOverlay.tsx`
- No backend changes

