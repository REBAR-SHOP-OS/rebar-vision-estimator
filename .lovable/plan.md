

## Fix: Blueprint Viewer for PDF Uploads and Bar List Projects

### Problem

Two issues prevent the "Show Where in Drawing" feature from working:

1. **PDF files cannot render in an `<img>` tag.** The BlueprintViewer uses `<img src={signedUrl}>`, but when users upload PDFs (the most common format), the browser cannot display them as images. The viewer never shows anything.

2. **Bar List projects produce no spatial data.** When the AI classifies a document as "BAR LIST ONLY", elements get `bbox: [0,0,0,0]` because there is no drawing to reference. The `hasDrawingData` check returns `false` and the "View on Drawing" button is hidden.

---

### Solution

**Phase 1: PDF Page Rendering with pdf.js**

Add PDF-to-canvas rendering so the viewer can display PDF pages as images. When the uploaded file is a PDF:
- Use Mozilla's `pdfjs-dist` library to load the PDF and render each page to a canvas/image
- Add page navigation controls (previous/next, page indicator) to the BlueprintViewer toolbar
- Each page renders as a bitmap that the existing SVG overlay system works on top of

**Phase 2: Bar List Mode -- Table Row Highlighting**

For "BAR LIST" projects, adapt the viewer to highlight table rows in the PDF:
- Update the `analyze-blueprint` system prompt to instruct the AI to output approximate page numbers and vertical positions for each parsed element (which page of the PDF the data was found on, and rough row position)
- The overlay shows horizontal band highlights on the relevant page, color-coded by element type
- Clicking an element card navigates to the correct page and highlights the row region

**Phase 3: Always Show Viewer When Files Exist**

Even when bbox data is sparse, allow users to view the uploaded document:
- Change `hasDrawingData` logic: show the viewer button whenever uploaded files exist (not only when overlay elements have valid bboxes)
- When no overlay data exists, show the PDF/image viewer in "read-only" mode without overlays
- Add a note: "No spatial data available -- elements were parsed from tabular data"

---

### Technical Changes

| File | Changes |
|---|---|
| `package.json` | Add `pdfjs-dist` dependency for PDF rendering |
| `src/components/chat/BlueprintViewer.tsx` | Add PDF detection (check if URL ends in `.pdf` or content-type); render PDF pages via pdfjs canvas; add page navigation (prev/next/page indicator); fall back to `<img>` for image files; pass current page dimensions to DrawingOverlay |
| `src/components/chat/DrawingOverlay.tsx` | Accept optional `pageNumber` prop to filter elements by page; support horizontal band overlays for bar-list row highlighting |
| `src/components/chat/ChatArea.tsx` | Change `hasDrawingData` to `uploadedFiles.length > 0` so the viewer button always appears when files exist; pass file type info to BlueprintViewer |
| `src/components/chat/ValidationResults.tsx` | Update "View on Drawing" button label to "View Document" when no bbox data exists; always show button when files are uploaded |
| `supabase/functions/analyze-blueprint/index.ts` | For BAR LIST projects, instruct AI to include `page_number` and approximate `y_position` (as percentage of page height) in each element's `regions.tag_region` so the viewer can navigate to the right page and highlight the row |

---

### New Dependencies

- `pdfjs-dist` -- Mozilla's PDF.js library for client-side PDF rendering (renders PDF pages to canvas elements)

---

### PDF Rendering Flow

1. User uploads a PDF file
2. BlueprintViewer detects PDF format from the URL or file type
3. Loads PDF via `pdfjs-dist` getDocument()
4. Renders the current page to an off-screen canvas, converts to image data URL
5. Displays the rendered page image with existing zoom/pan controls
6. Page navigation buttons (prev/next) in the toolbar switch between pages
7. SVG overlays filter to elements matching the current page number
8. Clicking an element card auto-navigates to the correct page and highlights it

---

### Updated Data Shape for Bar List Elements

The `regions.tag_region` for bar list elements will include:

```
{
  "bbox": [50, 200, 750, 240],   // approximate row region on the page
  "page_number": 3                // which PDF page
}
```

This gives the viewer enough information to navigate to the right page and draw a highlight band across the table row where the element data was found.

---

### Viewer Modes

| Upload Type | Viewer Behavior |
|---|---|
| Image file (PNG/JPG) | Shows image with SVG bbox overlays (current behavior) |
| PDF with blueprint drawings | Renders PDF pages, shows bbox overlays per page |
| PDF with bar list/tables | Renders PDF pages, shows row-band highlights, page navigation to relevant data |
| Any file, no bbox data | Shows document in read-only mode with "No spatial data" note |
