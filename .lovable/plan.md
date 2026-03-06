

## Plan: Rewrite Excel Export to Match Exact Format

### Problem
The current Excel export has generic sheets (Cover Page, Bar List, Size Summary, Bending Schedule, Elements Detail, Notes) that don't match the company's actual estimation file format. The uploaded `20_york_2-2.xlsx` shows the exact two-sheet structure needed.

### Target Format (from uploaded file)

**Sheet 1: "Estimate Summary"**
- Row 1: `Project Name :` | project title (merged across columns)
- Rows 2-4: Address, Engineer, Customer, Product Line
- Row 5: blank
- Row 6: "Estimate Summary" header
- Left side: **Weight Summary Report in Kgs** — table of sizes (10M, 15M, 20M...) with weight per size, grand total kg + tons
- Right side (same rows): **Element wise Summary Report in Kgs** — numbered list of element types (RAFT SLAB, WALL, GRADE BEAMS...) with weight per element, grand total kg + tons
- Below: NOTES section with grade/lap length info
- Below: MESH DETAILS table (Location, Mesh Size, Total Area SQFT)

**Sheet 2: "Bar List" (the detailed takeoff)**
- Row 1: `Project:` | project title
- Column headers: SL.No. | Identification | Multiplier | Qty | Bar Dia | Length in feet inches | Length in millimeters | Bend | Info 1 | Info 2 (@) | Total Length (Mtr.) | Total Wgt kg | Notes
- Rows grouped by element type headers (RAFT SLAB, WALL, GROUND FLOOR SLAB, GRADE BEAMS, PIERS, CABANA...)
- Sub-headers for sub-elements (SLAB S1-16" THK, FOUNDATION WALLS, CB-1, etc.)
- Each bar line: identification string like `20M @ 12" OC`, multiplier, qty, bar dia, lengths, bend type, info fields, total length in meters, total weight kg
- Bottom: TOTAL WEIGHT row + MESH DETAILS

### Changes

**File: `src/components/chat/ExportButtons.tsx`** — rewrite `handleExcelExport()`:

1. **Sheet 1 "Estimate Summary"**: Build AOA with project header rows, then side-by-side weight-by-size and weight-by-element tables using column offsets (size table cols A-B, element table cols F-H), grand totals, notes section with lap lengths from scope data, mesh details if available.

2. **Sheet 2 "Bar List"**: Build AOA with project header, then 13-column header row matching the exact column layout. Iterate bar_list grouped by element_type, output group headers and sub-element headers, then each bar row with: sequential SL.No., identification string (e.g. `{size} @ {spacing} {description}`), multiplier, qty, bar_dia, length_ft, length_mm, bend type (STRAIGHT BARS / BEND BARS), info1, info2, total_length_m, total_weight_kg, notes. End with TOTAL WEIGHT row and MESH DETAILS.

3. **Remove old sheets**: Drop Cover Page, Elements Detail, Notes, Bending Schedule sheets. Keep only the two sheets.

4. **Column widths and merges**: Match the uploaded file's layout with appropriate column widths and header merges.

### Scope
- 1 file modified: `src/components/chat/ExportButtons.tsx`
- No backend changes

