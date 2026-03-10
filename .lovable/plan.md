

## Plan: Style Excel Export to Match Reference Workbook

### Problem
The current Excel export has the correct data layout but no visual formatting — no colored headers, no borders, no bold text, no yellow total rows. The reference screenshots show a professionally styled workbook with teal project headers, green "Estimate Summary" banner, yellow Grand Total rows, salmon/orange column headers on the Bar List, and cell borders throughout.

The root cause is that the `xlsx` (SheetJS community edition) library does **not** support cell styling on write. We need to switch to `exceljs`, which provides full styling support (fills, fonts, borders, alignment) in the free version.

### Changes

#### 1. Install `exceljs` package
Add `exceljs` as a dependency. Remove `xlsx` usage from `excel-export.ts` (keep `xlsx` installed since it's used elsewhere for parsing imports).

#### 2. Rewrite `src/lib/excel-export.ts` using ExcelJS
Replace the XLSX-based sheet builders with ExcelJS equivalents. Same data logic, but now with styling
<lov-tool-use id="thinking-eae89cea-de1d-4d36-bc6c-8e735e366d18" name="lov-think" data="The current code uses SheetJS (xlsx) which doesn&apos;t support cell styling in the community edition. To match the reference screenshots with colored headers, borders, and highlighted rows, I need to switch to ExcelJS which supports full styling.

Let me propose the plan." duration="1.651414">
</lov-tool-use>
<lov-plan>

## Plan: Style Excel Export to Match Reference Workbook

### Problem
The current Excel export uses the `xlsx` (SheetJS) community edition, which **does not support cell styling** (colors, borders, bold text). The reference screenshots show specific formatting:
- Teal/green project header background
- Green banner for "Estimate Summary" title
- Underlined section headers ("Weight Summary Report in Kgs")
- Yellow highlighted "Grand Total" rows
- Orange/salmon column headers on Bar List sheet
- Bold element type headers (RAFT SLAB) and sub-element headers
- Cell borders throughout

### Solution
Replace `xlsx` with `exceljs` for the export, which fully supports cell styling (fills, borders, fonts, alignment) in the free version. The data logic stays identical — only the sheet-building functions change to use ExcelJS API with styling.

### Changes

**1. Install `exceljs` package**

**2. Rewrite `src/lib/excel-export.ts`** using ExcelJS API:

- **Estimate Summary sheet styling:**
  - Rows 1-5 (project header): teal background (`#8DB4B4`), bold labels
  - "Estimate Summary" banner: green fill (`#92D050`), centered, bold, merged
  - "Weight Summary Report" / "Element wise Summary Report" headers: underlined, bold
  - Column headers ("Size", "Weight", "SL.No.", "Element"): light gray fill, borders
  - Data rows: thin borders
  - "Grand Total" rows: yellow fill (`#FFFF00`), bold
  - NOTES section: bold header, normal data
  - Lap Length table: borders, headers
  - MESH DETAILS: green header, bordered table

- **Bar List sheet styling:**
  - Project header row: merged, bold
  - Column headers (SL.No. through Notes): salmon/orange fill (`#FFC7CE`), bold, borders, wrapped text
  - Element type headers (RAFT SLAB): bold, yellow fill, merged across all columns
  - Sub-element headers (SLAB S1-16" THK): bold, indented, light fill
  - Data rows: thin borders, right-aligned numbers
  - Total rows: bold, yellow highlight

- **Keep existing 3 power-user sheets** (Reconciliation, Audit Trace, Raw JSON) with basic styling

**3. Column widths** matched to reference:
  - Estimate Summary: ~8 columns matching current layout
  - Bar List: 13 columns with widths matching reference (SL.No=6, Identification=30, etc.)

### Scope
- 1 new dependency: `exceljs`
- 1 file rewritten: `src/lib/excel-export.ts`
- No backend changes, no data logic changes — only presentation layer

