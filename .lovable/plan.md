

## Interactive Page-by-Page Review + Shop Drawing Generation

### What Changes

**1. Page-by-Page Review Mode**

After the AI estimation completes, instead of just dumping all results at once, add a new interactive review flow that walks the customer through the document one page at a time:

- A "Review Document" button appears after estimation is done
- Opens a guided review panel that shows Page 1 in the BlueprintViewer, with all elements found on that page listed beside it
- Any element with confidence below 100% (or below 0.82 threshold) gets a confirmation prompt inline: "We detected [element] here with [X]% confidence. Is this correct?" with Yes/No/Edit buttons
- Customer confirms or corrects each flagged item, then clicks "Next Page" to proceed
- A progress bar shows "Page 3 of 15 reviewed"
- After all pages are reviewed, a summary shows what was confirmed, corrected, and the updated totals
- Answers are fed back into the validation pipeline (existing `runValidation` with `userAnswers`)

**2. "Create Shop Drawing" Button**

After the estimation (and optionally the review) is complete and a quote result exists, add a "Create Shop Drawing" button alongside the existing Export Excel / Download PDF buttons:

- Calls a new `generate-shop-drawing` edge function
- The edge function takes the finalized bar list (elements, bar marks, sizes, shapes, bend details, quantities) and uses AI to generate a professional shop drawing description/DXF-style output
- For MVP: generates a formatted PDF shop drawing with bar bending schedule, shape diagrams (using standard shape codes), and bar mark labels
- The PDF opens in a new tab for download/print

---

### New Components

**`PageReviewPanel.tsx`** -- The guided review UI

- Shows current page number and total pages
- Lists elements found on the current page with their confidence levels
- For items below 100% confidence: shows an inline confirmation card with the detected value, a "Confirm" button, and an "Edit" button (which opens a small input field)
- "Previous Page" / "Next Page" navigation
- Progress bar at top
- "Finish Review" button on the last page that triggers re-validation with all collected answers
- Tracks review state: `{ pageAnswers: Map<string, {confirmed: boolean, correctedValue?: string}> }`

---

### Updated Components

**`ValidationResults.tsx`**

- Add a "Review Document" button (appears after estimation, next to "View Document")
- Add a "Create Shop Drawing" button in the quote result section, next to existing Export buttons

**`ExportButtons.tsx`**

- Add a third button: "Create Shop Drawing" with a drafting icon
- On click, calls the `generate-shop-drawing` edge function with the full bar list and element data
- Shows a loading spinner while generating
- Opens the result (PDF) in a new tab

**`ChatArea.tsx`**

- Add `reviewMode` state (boolean) to toggle between normal results view and page-by-page review
- When review mode is active, show `PageReviewPanel` instead of `ValidationResults`
- Pass review answers back through existing `handleAnswerQuestion` flow
- After review completes, re-run validation and update results

---

### New Edge Function: `generate-shop-drawing`

- Receives: bar list array, element details, project metadata (name, client, standard)
- Uses AI (Gemini) to generate a formatted shop drawing with:
  - Bar bending schedule table (bar mark, size, shape code, dimensions, quantity)
  - Standard shape code diagrams described textually (for each unique shape)
  - Summary totals by size
  - Project header with name, client, date
- Outputs: HTML that renders as a printable shop drawing (similar to existing PDF export but with bending detail diagrams)
- Opens in new tab for print/save as PDF

---

### Technical Details

| File | Changes |
|---|---|
| `src/components/chat/PageReviewPanel.tsx` | New -- guided page-by-page review with confidence-based confirmation prompts, page navigation, progress tracking |
| `src/components/chat/ValidationResults.tsx` | Add "Review Document" button after estimation; pass review trigger callback |
| `src/components/chat/ExportButtons.tsx` | Add "Create Shop Drawing" button that calls the new edge function |
| `src/components/chat/ChatArea.tsx` | Add `reviewMode` state; toggle between ValidationResults and PageReviewPanel; handle review completion with re-validation |
| `supabase/functions/generate-shop-drawing/index.ts` | New edge function -- takes bar list + elements, uses AI to produce formatted shop drawing HTML/PDF |
| `supabase/config.toml` | Add `[functions.generate-shop-drawing]` with `verify_jwt = false` |

### Review Flow

1. User uploads PDF, AI runs estimation, results appear with element cards
2. User clicks **"Review Document"** button
3. BlueprintViewer opens on Page 1, PageReviewPanel shows elements found on Page 1
4. Low-confidence items show: "Detected: 4x 20M verticals (78% confidence) -- Confirm / Edit"
5. User confirms or edits each flagged item
6. User clicks "Next Page" -- viewer advances to Page 2, new elements shown
7. After last page: "Review Complete" summary with changes made
8. System re-runs validation with user corrections, updates weights/totals
9. User clicks **"Create Shop Drawing"** -- edge function generates formatted bending schedule PDF
10. PDF opens in new browser tab for printing

### Shop Drawing Output Format

The generated shop drawing will include:
- Project header (name, client, date, standard)
- Bar bending schedule table: Bar Mark, Size, Shape Code, Qty, Cut Length, Bend Dimensions (A, B, C, D, E), Total Weight
- Shape diagrams section: for each unique shape code, a text description of the bend geometry
- Size summary table
- Notes section with applicable standards (RSIC/ACI)
- Footer with disclaimer and generation date
