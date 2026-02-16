
## Show Finder Pass Results on Drawing with Inline Editing and Confirmation

### Problem
The Finder Pass (Stage 2) outputs a table of OCR candidates with bounding boxes, but this data only appears as a markdown table in the chat. Users can't see where each candidate is on the actual drawing, can't edit values if the OCR got something wrong, and can't confirm each one before the pipeline proceeds.

### Solution
Intercept the Finder Pass candidates from the streamed AI response, display them as interactive overlays on the Blueprint Viewer, and present a structured review panel where users can point at each candidate, edit its OCR text/values, and confirm or reject it before the pipeline moves to the next stage.

### How It Works

1. **Parse Finder Pass candidates from AI response** -- The AI streams a markdown table with columns like Page, Type, OCR Text, Potential For, Bbox. We extract these into a structured array using a regex/parser (similar to how `extractAtomicTruthJSON` works but for the Finder Pass table format).

2. **Show candidates as overlays on the drawing** -- Use the existing `BlueprintViewer` + `DrawingOverlay` system. Each Finder Pass candidate has a bbox, so we create `OverlayElement` objects and auto-open the viewer.

3. **Finder Pass Review Panel** -- A new component (`FinderPassReview`) that steps through each candidate one by one, showing:
   - The OCR text that was detected (editable input field)
   - The element type it maps to (editable dropdown)
   - The bounding box location (highlighted on the drawing)
   - Confirm / Edit / Reject buttons
   - Progress bar showing how many reviewed

4. **Feed corrections back** -- Confirmed/edited candidates continue through the pipeline; rejected ones are excluded.

### Visual Design

Each candidate card shows:
- A colored header with the candidate type (e.g., "Detail Title", "Local Note")
- The raw OCR text in a monospace editable field
- The "Potential For" element in a badge (e.g., CAISSON-4.5M)
- Page number and bbox coordinates (read-only, for reference)
- Three action buttons: Confirm (green), Edit (amber), Reject (red)

The Blueprint Viewer auto-pans to each candidate as the user steps through them.

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/FinderPassReview.tsx` | **New file.** A review panel component that receives parsed Finder Pass candidates. For each candidate, it renders: editable OCR text field, element type selector, confidence display, and Confirm/Edit/Reject buttons. Stepping through candidates triggers `onSelectElement` to sync with the drawing. On completion, emits the cleaned candidate list back to the parent. |
| `src/components/chat/ChatArea.tsx` | Add state for `finderPassCandidates` (parsed from AI response). Add a `extractFinderPassCandidates(content)` parser that finds the markdown table in the Finder Pass stage and converts rows into structured objects with `{page, type, ocrText, potentialFor, bbox, id}`. When candidates are detected, auto-open the BlueprintViewer and show the FinderPassReview panel (similar to how ElementReviewPanel is shown). Build `OverlayElement[]` from the candidates' bboxes so they appear on the drawing. On review completion, store confirmed candidates and allow the pipeline to continue. |
| `src/components/chat/DrawingOverlay.tsx` | Add a "FINDER_CANDIDATE" color entry to `ELEMENT_TYPE_COLORS` (e.g., cyan `#06B6D4`) so Finder Pass overlays have a distinct look before they're classified into element types. |

### Interaction Flow

1. User starts analysis, AI streams the Finder Pass
2. When the Finder Pass table is detected in the stream, candidates are parsed and overlays appear on the drawing
3. A "Review Finder Pass Results" panel appears below the chat message
4. User steps through each candidate: the drawing pans/zooms to it
5. User can edit the OCR text (fix misreads like O vs 0), change the element type, or reject false positives
6. On completion, corrected candidates feed into the next pipeline stage
