

## Plan: Fix XLSX Parser for Real-World Rebar Takeoff Format

### Problem
The current `parseXlsxToBarItems` in `BarListTable.tsx` uses `XLSX.utils.sheet_to_json` which assumes a simple single-row header layout. The real "20 York Valley" XLSX has:
- **Multi-row headers** split across 2 rows ("Multi-" / "plier", "Length in" / "millimeters")
- **Section header rows** ("RAFT SLAB", "WALL", "GROUND FLOOR SLAB") used as element type grouping
- **Sub-section rows** ("SLAB S1-16" THK", "FOUNDATION WALLS") as element IDs
- **Blank separator rows** between groups
- **Pre-computed weights** in a "Total Wgt kg" column (44,777 kg grand total)
- CSA metric sizes (10M, 15M, 20M) with lengths in millimeters

The parser must be rewritten to handle this format while remaining backward-compatible with simpler flat-header spreadsheets.

### Key Data from XLSX (Audit Reference)

| Element Group | Weight (kg) |
|---|---|
| RAFT SLAB | 27,201.09 |
| WALL | 9,309.49 |
| GROUND FLOOR SLAB | 6,773.66 |
| GRADE BEAMS | 431.58 |
| PIERS | 247.76 |
| CABANA GRADE BEAMS | 583.89 |
| CABANA WALLS | 229.85 |
| **Grand Total** | **44,777 kg** |

Sizes: 10M (261.74 kg), 15M (18,657.43 kg), 20M (25,858.14 kg)

### Changes

**1. Rewrite parser in `BarListTable.tsx`**

Replace `sheet_to_json` approach with `sheet_to_json({ header: 1 })` (array-of-arrays) to handle multi-row headers:

- **Scan rows** to find the header row by looking for known column patterns ("Qty", "Bar Dia", "Length", "Multi")
- **Merge multi-row headers** if the row above the data header contains partial labels
- **Build column index map**: `{ qty: colIdx, size: colIdx, length_mm: colIdx, multiplier: colIdx, identification: colIdx, weight_kg: colIdx, bend: colIdx, info: colIdx, ref: colIdx }`
- **Track current section** (element_type) from rows where only 1-2 cells are filled with text like "RAFT SLAB", "WALL"
- **Track current sub-section** (element_id) from rows like "SLAB S1-16" THK"
- **Skip empty rows** and the serial number column
- **Parse data rows**: extract multiplier, qty, size (append "M" if just a number in metric context), length_mm, shape from "Bend" column
- **Use pre-computed weight** from "Total Wgt kg" column when available, falling back to formula computation
- **Cross-check** computed vs pre-computed weight, flag mismatches > 2%

**2. Add new header candidates to constants**

Add recognition for real-world header variants:
- MULTIPLIER_HEADERS: add "Multi-plier", "Multiplier", "MULTI"
- SIZE_HEADERS: add "Bar Dia", "BAR DIA"
- LENGTH_HEADERS: add "Length in millimeters", "LENGTH IN MILLIMETERS"
- MARK_HEADERS: add "Indentification", "IDENTIFICATION"
- Add new: WEIGHT_HEADERS: "Total Wgt", "TOTAL WGT", "Total Weight", "weight kg"
- Add new: BEND_HEADERS: "Bend", "BEND", "Shape"
- Add new: INFO_HEADERS: "Info", "INFO", "Placement"
- Add new: REF_HEADERS: "@", "Sheet", "REF", "Reference"

**3. Detect metric vs imperial context**

If size column contains values like "10", "15", "20" (bare numbers) and headers mention "millimeters" or "Mtr", auto-append "M" suffix (CSA metric). If headers mention "feet" or sizes start with "#", use imperial.

**4. Backward compatibility**

Keep the existing flat-header parsing as fallback. The new parser:
1. First tries array-of-arrays scan for complex layouts
2. If it finds a valid header row with >= 3 recognized columns, uses the new parser
3. Otherwise falls back to the existing `sheet_to_json` parser

**5. Import diagnostics improvements**

- Show element-wise weight summary matching the XLSX summary page
- Show computed vs XLSX-stated total with mismatch %
- Flag rows where computed weight differs from pre-computed weight by > 2%

### Files to Modify

1. **`src/components/chat/BarListTable.tsx`** — rewrite `parseXlsxToBarItems` with array-of-arrays scanning, section tracking, multi-row header merging, and metric size detection. Add new header constants.

### Expected Outcome
Importing `20_york_2.xlsx` should yield ~120 line items across 7 element groups, totaling ~44,777 kg with < 1% mismatch from the XLSX's own stated total.

