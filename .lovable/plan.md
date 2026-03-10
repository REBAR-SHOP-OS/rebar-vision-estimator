

## Plan: Align PDF Export to Match Excel Two-Sheet Layout

### Problem
The PDF export (lines 30-78 in `ExportButtons.tsx`) uses an old format with summary boxes, a flat bar list, a separate size summary page, and a bending schedule. It needs to match the same two-section structure as the Excel export.

### Changes

**File: `src/components/chat/ExportButtons.tsx`** — rewrite `handlePdfExport()` (lines 30-78)

Replace the entire PDF HTML generation with two sections mirroring the Excel sheets:

**Section 1: "Estimate Summary"** (page 1)
- Project header: Project Name, Address, Engineer, Customer, Product Line
- "Estimate Summary" title
- Side-by-side tables using CSS grid/flexbox:
  - Left: **Weight Summary Report in Kgs** — bar sizes with weight, grand total kg + tons
  - Right: **Element wise Summary Report in Kgs** — numbered element types with weight, grand total kg + tons
- NOTES section: Grade, Lap Length Info, Deviations, Coating
- Scope Items (if any)
- MESH DETAILS table

**Section 2: "Bar List"** (page 2+, page-break-before)
- Project header
- 13-column table matching Excel: SL.No., Identification, Multiplier, Qty, Bar Dia, Length ft-in, Length mm, Bend, Info 1, Info 2, Total Length (Mtr.), Total Wgt kg, Notes
- Rows grouped by element type headers (bold row spanning columns)
- Sub-element sub-headers
- Bar rows with identification string (`{size} @ {spacing} {description}`)
- TOTAL WEIGHT + TOTAL (Tons) footer rows
- MESH DETAILS at bottom

The data computation logic will reuse the same grouping/calculation patterns from `excel-export.ts` (groupBy, mmToFtIn, weight calculations).

### Scope
- 1 file modified: `src/components/chat/ExportButtons.tsx` (rewrite `handlePdfExport`)
- No new files, no backend changes

