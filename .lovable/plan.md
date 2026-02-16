

## Make Drawing Markers Bigger, Labels Always Visible, and Auto-Open Element Panel

### Problem
The current markers on the drawing are still not obvious enough. Labels only appear on hover or selection, and clicking an element on the drawing doesn't clearly open its details.

### Changes

#### 1. Bigger and Bolder Center Dots
**File: `src/components/chat/DrawingOverlay.tsx`**
- Increase default dot radius from 10 to 16px
- Increase selected/hovered/active dot radius from 14 to 20px
- Add a thicker white border (strokeWidth 3 instead of 2) for better contrast

#### 2. Always-Visible Labels
**File: `src/components/chat/DrawingOverlay.tsx`**
- Remove the conditional `{(isSelected || isHovered || isActive) && ...}` wrapper around the label group
- Labels will now always render for every visible element, showing the element ID and type
- On hover/select, the label styling will get slightly bolder (increase opacity or size) to distinguish the active one

#### 3. Auto-Open Element Details Panel on Click
**File: `src/components/chat/ChatArea.tsx`**
- In `handleSelectElementFromViewer`, when a user clicks an element on the drawing:
  - Scroll to the corresponding element card in the results list (already works)
  - Automatically open the element's collapsible group if it is collapsed
  - Add a brief highlight animation on the card to draw attention

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/DrawingOverlay.tsx` | Increase dot radii (16/20px), make labels always visible, thicker white border on dots |
| `src/components/chat/ChatArea.tsx` | Enhance `handleSelectElementFromViewer` to auto-expand collapsed groups and highlight the target card |

