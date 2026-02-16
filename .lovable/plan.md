

## Element-by-Element Guided Review with Drawing Markers

### Overview

Replace the current page-by-page review flow with a focused **element-by-element** walkthrough. Instead of showing all elements on a page at once, the reviewer steps through **one element at a time**, with the Blueprint Viewer automatically zooming to and highlighting that element's location on the drawing.

---

### How It Works

1. User clicks **"Review Elements"** after estimation
2. The Blueprint Viewer opens alongside a new **ElementReviewPanel**
3. The panel focuses on **Element 1 of N** -- showing its ID, type, confidence, and extracted data
4. The drawing automatically zooms to and pulses/highlights the element's bounding box
5. User chooses: **Confirm**, **Edit**, or **Reject**
6. Clicking **Next** advances to Element 2, the drawing pans to that element
7. A progress bar at the top shows "3 / 12 elements reviewed"
8. Low-confidence elements (below 82%) get a warning banner prompting extra attention
9. After the last element, a summary screen shows confirmed/corrected/rejected counts
10. Corrections feed back into the validation pipeline to update totals

### Drawing Marking

- The **currently reviewed element** gets a pulsing highlight (thicker border + animated glow) on the drawing overlay
- **Confirmed** elements turn green with a checkmark indicator
- **Rejected** elements turn red with an X indicator
- **Not yet reviewed** elements remain in their default semi-transparent color
- The viewer auto-zooms and pans to center each element as the user steps through

---

### Technical Changes

| File | Change |
|---|---|
| `src/components/chat/PageReviewPanel.tsx` | Rewrite into `ElementReviewPanel` -- single-element focus with prev/next navigation, progress bar, auto-select on step change |
| `src/components/chat/DrawingOverlay.tsx` | Add `reviewStatus` map prop to color-code elements by review state (confirmed=green, rejected=red, active=pulsing); add CSS animation for active element |
| `src/components/chat/ChatArea.tsx` | Replace `PageReviewPanel` usage with new `ElementReviewPanel`; pass review state to overlay elements; track `reviewAnswers` map for overlay coloring |
| `src/components/chat/ValidationResults.tsx` | Rename button from "Review Document" to "Review Elements" |
| `src/index.css` | Add `@keyframes` pulse animation for the active review element overlay |

### New ElementReviewPanel UI Layout

```text
+------------------------------------------+
| Review Elements          [3 / 12]  Cancel |
| [==========>              ] 25%           |
+------------------------------------------+
|  FOOTING-ISO                    FOOTING   |
|  Confidence: 50%  [!!!]                   |
|                                           |
|  Extracted Data:                          |
|  +--------------------------------------+|
|  | vertical_bars: 4x 20M                ||
|  | ties: 10M @ 300mm                    ||
|  +--------------------------------------+|
|                                           |
|  [!] Low confidence -- please verify      |
|                                           |
|  [ Confirm ]  [ Edit ]  [ Reject ]        |
+------------------------------------------+
|        [ < Prev ]  [ Next > ]             |
+------------------------------------------+
```

### DrawingOverlay Review States

The overlay will accept an optional `reviewStatuses` prop:

```text
Map<string, "confirmed" | "rejected" | "active" | "pending">
```

- `active`: pulsing border animation (2px dashed + glow), fill opacity 0.25
- `confirmed`: green border, green fill at 0.1 opacity, small checkmark icon
- `rejected`: red border, red fill at 0.1 opacity
- `pending`: default semi-transparent (current behavior)

### Data Flow

1. `ElementReviewPanel` maintains current element index and answers map
2. On each step change, it calls `onSelectElement(currentElement.element_id)` which triggers the BlueprintViewer to zoom to that element
3. The `reviewAnswers` map is passed up to `ChatArea` which converts it into a `reviewStatuses` map for the overlay
4. On completion, answers are converted to `userAnswers` format and fed to `runValidation`

### CSS Animation (added to index.css)

```text
@keyframes review-pulse {
  0%, 100% { stroke-opacity: 1; stroke-width: 3; }
  50% { stroke-opacity: 0.5; stroke-width: 5; }
}
```

Applied via the class `.review-active-element` on the SVG rect in DrawingOverlay.

