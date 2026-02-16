

## Upgrade Shop Drawing: Options Modal, Progress, Preview, and History

### What Changes

The current "Create Shop Drawing" button fires an API call and opens the result in a new tab with no configuration, no progress feedback, and no history. We'll upgrade this into a full-featured flow:

1. **Options Modal** -- Clicking "Create Shop Drawing" opens a dialog with configuration fields before generating
2. **Progress Tracking** -- A progress indicator with status text while the AI generates
3. **Preview and Download** -- Show the generated HTML in an inline preview (iframe) with a proper download-as-PDF button
4. **Job History** -- Save all generated shop drawings to the database so users can re-view and re-download past versions

### Flow

```text
[Create Shop Drawing] button click
        |
        v
  +----------------------------+
  | Options Modal              |
  | - Scale: 1:1, 1:25, 1:50  |
  | - Include Dimensions: Y/N  |
  | - Layer Grouping: Y/N      |
  | - Bar Marks: Y/N           |
  | - Drawing Prefix: text     |
  | - Notes: textarea          |
  | [Generate]    [Cancel]     |
  +----------------------------+
        |
        v
  Progress overlay:
  "Preparing data... 20%"
  "Generating layout... 60%"
  "Finalizing... 90%"
        |
        v
  +----------------------------+
  | Preview Panel              |
  | [iframe with HTML preview] |
  | [Print/Save PDF] [Close]   |
  +----------------------------+
        |
  Auto-saved to history
        |
        v
  History tab shows past drawings
  with date, options, re-view/download
```

### Database Changes

A new `shop_drawings` table stores generated outputs:

| Column | Type | Description |
|---|---|---|
| id | uuid PK | Auto-generated |
| project_id | uuid | FK to projects |
| user_id | uuid | Owner |
| options | jsonb | Scale, toggles, notes |
| html_content | text | Generated HTML |
| created_at | timestamptz | When generated |
| version | integer | Auto-incrementing per project |

RLS: Users can only see/create/delete their own shop drawings.

### Edge Function Changes

Update `generate-shop-drawing` to accept the new options (scale, includeDims, layerGrouping, barMarks, drawingPrefix, notes) and incorporate them into the AI prompt so the output reflects the user's choices.

### Frontend Changes

| File | Change |
|---|---|
| `src/components/chat/ShopDrawingModal.tsx` | **New file.** A Dialog component with: (1) Options form -- scale select, toggle switches for dimensions/layers/bar marks, text inputs for prefix and notes. (2) Progress state with animated bar and status messages. (3) Preview state with an iframe rendering the generated HTML. (4) History list fetched from `shop_drawings` table showing past versions with "View" and "Delete" actions. |
| `src/components/chat/ExportButtons.tsx` | Replace the inline `handleShopDrawing` logic with opening the new `ShopDrawingModal`. Pass through `quoteResult`, `elements`, `scopeData` as props. Remove the old direct-call pattern. |
| `supabase/functions/generate-shop-drawing/index.ts` | Accept `options` object in request body. Inject scale, dimension preferences, layer grouping, bar marks toggle, prefix, and notes into the AI prompt so the generated HTML respects user choices. |

### Options Modal Fields

- **Scale**: Dropdown -- `1:1`, `1:25`, `1:50`, `1:100`
- **Include Dimensions**: Toggle (default ON) -- adds dimension lines and length annotations
- **Layer Grouping**: Toggle (default ON) -- groups bars by element type with section headers
- **Show Bar Marks**: Toggle (default ON) -- labels each bar with its mark ID
- **Drawing Number Prefix**: Text input -- e.g. "SD-" prepended to the drawing number
- **Special Notes**: Textarea -- any text the user wants on the notes section

### Progress Simulation

Since the edge function is a single synchronous call (not a real job queue), we simulate progress on the frontend:
- 0-20%: "Preparing bar data..." (immediate)
- 20-60%: "Generating shop drawing layout..." (after 2s)
- 60-90%: "Adding dimensions and annotations..." (after 5s)
- 90-100%: "Finalizing..." (on response received)

This gives visual feedback during the ~10-15 second AI generation time.

### History Panel

Inside the modal, a "History" tab shows past shop drawings for the current project:
- Each entry shows: version number, date, scale used, a "View" button (opens preview), and a "Delete" button
- Fetched from `shop_drawings` table filtered by `project_id`
- Latest version shown first

