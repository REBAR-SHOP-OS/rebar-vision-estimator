

## Blueprint Viewer -- "Show Where in Drawing" Feature

Add an interactive blueprint viewer that displays the uploaded drawing with colored overlay rectangles highlighting where each detected element was found on the drawing, similar to Beam AI's visual takeoff interface.

---

### What You'll See

After the AI analysis completes and returns element results, a new **"View on Drawing"** toggle button appears above the results. When activated:

- A split-panel layout shows the **blueprint image on the left** and the **results list on the right**
- Colored rectangles overlay the drawing at each element's detected location
- Clicking an element card in the results highlights and zooms to it on the drawing
- Clicking a rectangle on the drawing scrolls to and highlights that element's card
- A legend and element-type filter toolbar sits at the top of the viewer

---

### New Components

**1. `BlueprintViewer.tsx`** -- The main interactive viewer

- Loads the uploaded blueprint image from the signed URL
- Renders SVG overlay rectangles on top of the image for each element's `regions.tag_region.bbox`
- Color-coded by element type (Columns = blue, Footings = orange, Beams = green, etc.)
- Supports zoom (mouse wheel / pinch) and pan (click-drag)
- Toolbar: zoom in, zoom out, fit-to-screen, element-type filter chips
- Tooltip on hover showing element ID, type, status, and confidence
- Selected element gets a pulsing glow border
- Legend with colored squares per element type

**2. `DrawingOverlay.tsx`** -- Lightweight SVG layer

- Renders positioned rectangles based on normalized bbox coordinates
- Handles click events to select elements
- Handles hover events for tooltips
- Color map: COLUMN=#3B82F6, FOOTING=#F59E0B, BEAM=#10B981, WALL=#8B5CF6, SLAB=#14B8A6, PIER=#EC4899, OTHER=#6B7280

---

### Updated Components

**3. `ValidationResults.tsx`** -- Add "Show on Drawing" per element

- Each `ElementCard` gets a small map-pin icon button
- Clicking it fires `onShowOnDrawing(element_id)` callback
- Selected element card gets a highlighted ring/border
- New toggle button at top: "View Drawing" with a map icon

**4. `ChatArea.tsx`** -- Split-panel layout

- When the blueprint viewer is active, switch from single-column to a `ResizablePanelGroup` (already installed via `react-resizable-panels`)
- Left panel: BlueprintViewer (default 55% width)
- Right panel: existing chat/results content (45%)
- State: `showBlueprintViewer` toggle, `selectedElementId` for syncing between viewer and results
- Pass `uploadedFiles[0]` URL and `validationData.elements` to BlueprintViewer

**5. `analyze-blueprint/index.ts`** -- Reinforce bbox output

- Add a note in the system prompt reinforcing that the AI should output real OCR bounding box coordinates (from the Google Vision data) into each element's `regions.tag_region.bbox` field rather than `[0,0,0,0]`
- This ensures meaningful overlay positioning

---

### Visual Design

- Dark semi-transparent toolbar at the top of the viewer with rounded controls
- Overlay rectangles: 2px colored border, 10% opacity fill, rounded corners
- Selected element: 3px border with CSS pulsing glow animation
- Hover tooltip: dark card with element details (ID, type, weight, confidence %)
- Legend: small colored squares in the bottom-left corner
- Filter chips: toggle visibility per element type
- On mobile: viewer is full-width and shown above results (stacked, not side-by-side)

---

### Element Type Color Map

| Type | Color | Hex |
|---|---|---|
| COLUMN | Blue | #3B82F6 |
| FOOTING | Orange | #F59E0B |
| BEAM | Green | #10B981 |
| WALL | Purple | #8B5CF6 |
| SLAB | Teal | #14B8A6 |
| PIER | Pink | #EC4899 |
| STAIR | Indigo | #6366F1 |
| OTHER | Gray | #6B7280 |

---

### Data Flow

1. AI analysis returns elements with `regions.tag_region.bbox` coordinates (from OCR bounding boxes)
2. User clicks "View Drawing" toggle
3. ChatArea switches to split-panel layout using `ResizablePanelGroup`
4. BlueprintViewer loads the first uploaded file's image and renders SVG overlays at each element's bbox position
5. User clicks an element card -- viewer smoothly zooms/pans to center that element's region
6. User clicks an overlay rectangle -- results panel scrolls to and highlights that element's card

---

### Technical Details

| File | Changes |
|---|---|
| `src/components/chat/BlueprintViewer.tsx` | New -- Image viewer with SVG overlay, zoom/pan, toolbar, tooltips, element selection |
| `src/components/chat/DrawingOverlay.tsx` | New -- SVG rectangle layer with color-coding, click/hover handlers |
| `src/components/chat/ValidationResults.tsx` | Add "Show on Drawing" button per element; add "View Drawing" toggle; highlight selected element; new props for `onShowOnDrawing` and `selectedElementId` |
| `src/components/chat/ChatArea.tsx` | Split-panel layout with ResizablePanelGroup when viewer active; selectedElementId state; pass data to BlueprintViewer |
| `supabase/functions/analyze-blueprint/index.ts` | Add prompt reinforcement to output real bbox coordinates from OCR data |
| `src/index.css` | Add `@keyframes blueprint-pulse` animation for selected overlay glow |

