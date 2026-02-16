

## Make the UI Foolproof with Visual Guidance

### Problem
The current interface shows elements like "LEGEND: PIER" without explaining what to do. Users shouldn't need to guess what things mean or what action to take.

### Changes

**1. Blueprint Viewer Legend - Add counts and action hints**

In `BlueprintViewer.tsx`, enhance the bottom-right legend box to show:
- Element type name with count (e.g., "PIER - 2 found")
- A subtle hint: "Click any box to see details"

**2. Element Cards - Add "What is this?" context**

In `ValidationResults.tsx`, add a one-line plain-English description under each element card header explaining what the element is:
- PIER: "A deep foundation element (caisson)"
- COLUMN: "A vertical structural member"
- BEAM: "A horizontal structural member"
- FOOTING: "A base that transfers load to ground"
- CAGE: "A pre-assembled rebar cage"
- etc.

**3. Drawing Overlay Labels - Make them readable**

In `DrawingOverlay.tsx`, increase the label font size slightly and add the element type after the ID (e.g., "CAISSON-4.5M | PIER") so users instantly know what each box represents without hovering.

**4. First-time guidance banner on Blueprint Viewer**

In `BlueprintViewer.tsx`, show a dismissible tip banner at the top when the viewer opens:
> "Colored boxes highlight detected elements. Click any box to select it, or use the filter chips above to show/hide types."

This disappears after first interaction.

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/BlueprintViewer.tsx` | Add dismissible guidance banner; enhance legend with counts and "click to select" hint |
| `src/components/chat/DrawingOverlay.tsx` | Append element type to label text (e.g., "CAISSON-4.5M | PIER"); widen label background accordingly |
| `src/components/chat/ValidationResults.tsx` | Add plain-English element type descriptions under each card header |
| `src/components/chat/ElementReviewPanel.tsx` | Add a one-line instruction at top: "Verify each element below. Click Confirm, Edit, or Reject, then move to Next." |

