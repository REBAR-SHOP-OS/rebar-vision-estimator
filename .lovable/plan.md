

## Build Interactive Bar List Table and Improve the App

This plan adds a dedicated, editable Bar List Table as the primary results view, plus several improvements to the overall app quality.

### 1. Interactive Bar List Table Component

Create a new `src/components/chat/BarListTable.tsx` component that displays all detected bars in an editable, sortable table format:

- **Columns**: Bar Mark, Size, Shape Code, Qty, Length (ft), Unit Weight (lb/ft), Total Weight (lbs)
- **Grouped by element type** with collapsible sections and subtotals per group
- **Inline editing**: Click any cell (Qty, Length, Size) to edit it directly -- changes auto-recalculate weight using the existing REBAR_UNIT_WEIGHT lookup
- **Row highlighting**: Click a row to highlight the corresponding element on the Blueprint Viewer (uses the existing `onShowOnDrawing` callback)
- **Status indicators**: Color-coded left border per row (green = READY, amber = FLAGGED, red = BLOCKED)
- **Grand total row** at the bottom with total weight in lbs and tons
- **Search/filter bar** at top to filter by bar mark, size, or element type

### 2. Integrate Bar List Table into Results Flow

In `ChatArea.tsx`, add a tab system in the results area with two tabs:
- **Cards View** (current ValidationResults component)
- **Bar List View** (new BarListTable component)

This uses the existing `validationData` and `quoteResult` state -- no new data fetching needed.

### 3. Bending Schedule Panel

Create `src/components/chat/BendingScheduleTable.tsx`:
- Filters the bar list to show only bent bars (shape_code is not "straight" or "closed")
- Columns: Element ID, Bar Mark, Size, Shape Code, Qty, Leg A/B/C dimensions, Weight
- Inline editing for dimensions
- Accessible as a third tab in the results area

### 4. App Quality Improvements

**Processing state indicator** (in `StepProgress.tsx`):
- Show "In Queue", "Processing", "Ready" status labels alongside the existing step dots
- Add a pulsing animation on the active step

**Better empty states**:
- When no results yet but files uploaded, show a clearer "waiting for analysis" state
- Improve the scope panel's loading skeleton during detection

### About Computer Vision Models

Adding Detectron2 or similar CV models requires a Python GPU backend, which cannot run in browser or in Deno edge functions. The current architecture (Google Vision OCR + Gemini) already provides strong detection. To add CV models in the future, you would need:
- A separate Python backend service (e.g., on AWS/GCP with GPU)
- An edge function that proxies requests to that service
- The UI we are building now (Bar List Table, Bending Schedule) is already designed to display results from any detection backend, so it will work seamlessly when CV models are added later

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/BarListTable.tsx` | NEW -- Editable bar list table with grouping, inline edit, live weight recalculation, row selection sync with Blueprint Viewer |
| `src/components/chat/BendingScheduleTable.tsx` | NEW -- Filtered view of bent bars with shape/dimension columns |
| `src/components/chat/ChatArea.tsx` | Add tab switcher (Cards / Bar List / Bending) in the results section; pass quoteResult bar_list data to new components |
| `src/components/chat/ValidationResults.tsx` | Extract the tab container logic; keep existing card view as default |
| `src/components/chat/StepProgress.tsx` | Add status labels ("Uploading", "Analyzing", "Validating", "Complete") and pulsing animation on active step |
| `src/components/chat/ExportButtons.tsx` | No changes needed -- already exports bar list and bending schedule from the same data |

