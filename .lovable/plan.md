
## Add a Features Side Panel to the Blueprint Viewer

### What We're Building
Inspired by the reference image, we'll add a **"Features" side panel** on the left side of the Blueprint Viewer that lists all detected element types with their colored dots, counts, individual elements, and toggle visibility -- similar to professional takeoff software like PlanSwift or Bluebeam.

### Layout Change

The current BlueprintViewer is a single column (toolbar + canvas). We'll restructure it to:

```text
+------------------+-------------------------------+
|  Features Panel  |        Drawing Canvas         |
|  (collapsible)   |                               |
|                  |                               |
|  - COLUMN (3)    |     [blueprint image with     |
|    * C1          |      overlay markers]          |
|    * C2          |                               |
|    * C3          |                               |
|  - FOOTING (2)   |                               |
|    * F1          |                               |
|    * F2          |                               |
|  - BEAM (4)      |                               |
|    ...           |                               |
+------------------+-------------------------------+
```

### Features Panel Details

1. **Header**: "Features" title with a close/collapse button
2. **Group by element type**: Each type gets a collapsible section with:
   - Colored dot matching the element's color from `ELEMENT_TYPE_COLORS`
   - Type name (e.g., "COLUMN")
   - Count badge
   - Eye icon to toggle visibility of that type on the drawing
3. **Individual elements listed under each type**:
   - Small colored dot
   - Element ID (e.g., "C1")
   - Click to select and zoom to that element on the drawing
   - Highlighted background when selected
   - Review status indicator (green check, red X) if in review mode
4. **Search/filter bar** at the top to quickly find elements by ID

### Toolbar Cleanup
- Remove the type filter chips from the toolbar (they move into the Features panel)
- Remove the bottom-right Legend overlay (replaced by the panel)
- Keep zoom controls and PDF navigation in the toolbar

### Files Changed

| File | Change |
|---|---|
| `src/components/chat/BlueprintViewer.tsx` | Restructure layout to include a left Features panel alongside the canvas. Move type filtering logic into the panel. Remove legend overlay and toolbar filter chips. Add collapsible element type groups with individual element rows. Add search input. Wire click-to-select and visibility toggles. |

### Technical Approach

- The panel will be a `div` with fixed width (~260px) on the left side of the viewer, using flexbox
- Each element type becomes a collapsible section using Radix Collapsible or simple state toggles
- Clicking an element row calls `onSelectElement(id)` which triggers the existing zoom-to-element logic
- The eye toggle per type reuses the existing `visibleTypes` state and `toggleType` function
- Selected element gets a highlighted background in the list (using the element's color at low opacity)
- ScrollArea component wraps the panel content for overflow handling
- Panel is hidden on mobile (too narrow) -- mobile keeps the existing toolbar chips
