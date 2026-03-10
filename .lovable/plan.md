

## Plan: Reformat Excel & PDF Exports to Match Reference Workbook

### Problem
The current Excel export produces 6 generic sheets (Summary, Rebar Items, Wire Mesh, etc.) that don't match the professional 2-sheet format used in the uploaded reference workbook (`20_york-2.xlsx`). The user wants both Excel and PDF exports to mirror this exact layout.

### Reference Format (from uploaded file)

**Sheet 1 — "Estimate Summary"**
- Project header block: Project Name, Address, Engineer, Customer, Product Line
- Side-by-side tables: "Weight Summary Report in Kgs" (by bar size) | "Element wise Summary Report in Kgs" (numbered elements with weight)
- Grand Total (kg) + Grand Total (Tons) footer on both tables
- NOTES section: Grade, Lap lengths by bar size
- MESH DETAILS table: Location, Mesh Size, Total Area (SQFT)

**Sheet 2 — "Bar List"**
- Project header row
- 13-column table: SL.No., Identification, Multiplier, Qty, Bar Dia, Length ft-in, Length mm, Bend, Info 1, Info 2/@, Total Length (Mtr.), Total Wgt kg, Notes
- Rows grouped by element type headers (e.g., "RAFT SLAB") and sub-element headers (e.g., "SLAB S1-16\" THK")
- Identification format: `{size} @ {spacing} {description}`
- TOTAL WEIGHT + TOTAL (Tons) footer
- MESH DETAILS repeated at bottom

### Changes

**File: `src/lib/excel-export.ts`** — Full rewrite

Replace the 6-sheet builder with a 2-sheet builder matching the reference:

- `buildEstimateSummarySheet()`: Uses `XLSX.utils.aoa_to_sheet` to lay out the header block, then side-by-side weight tables (using column offsets — size table in cols A-B, element table in cols F-H), grand totals, notes, and mesh details. Applies cell merges for headers.

- `buildBarListSheet()`: Project header row, then the 13-column table. Bars grouped by `element_type` with bold group-header rows spanning all columns, sub-element sub-headers, then bar detail rows with the `{size} @ {spacing} {description}` identification format. Computes Total Length (Mtr.) and Total Wgt (kg) per row. Footer rows: TOTAL WEIGHT and TOTAL (Tons). Mesh details at bottom.

- Keep Reconciliation, Audit Trace, and Raw JSON as optional additional sheets (sheets 3-5) for power users — the reference format is sheets 1-2.

**File: `src/components/chat/ExportButtons.tsx`** — No changes needed

The PDF export already matches the 2-section layout. The `handlePdfExport` function already produces the correct format with side-by-side summary tables and a 13-column bar list.

### Scope
- 1 file rewritten: `src/lib/excel-export.ts`
- No new files, no backend changes, no schema changes

