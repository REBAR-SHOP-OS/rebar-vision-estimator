

# Estimate Export — Professional Excel Format (Like Reference File)

## Problem
The Outputs tab "Estimate Summary" export currently produces a basic CSV. The user wants it to export a professional Excel file matching the uploaded reference file (20_york-5.xlsx), which has:
- **Sheet 1**: Project header, weight-by-size summary, element-wise summary, grand totals, notes, mesh details
- **Sheet 2**: Full bar list grouped by element with columns: SL.No., Identification, Multiplier, Qty, Bar Dia, Length ft-in, Length mm, Bend, Info, Total Length, Total Weight

## What Changes

### OutputsTab.tsx — Replace CSV export with Excel export
When the user clicks "Export" on "Estimate Summary", instead of generating a plain CSV, fetch all `estimate_items`, `bar_items`, and `segments` for the project, assemble a `quoteResult`-like object, and call the existing `exportExcelFile()` from `src/lib/excel-export.ts`.

### Existing excel-export.ts already matches the reference format
The `buildEstimateSummarySheet` and `buildBarListSheet` functions already produce a 2-sheet Excel with:
- Teal project header, weight-by-size table, element-wise breakdown, grand totals in yellow, notes, mesh details
- Bar list grouped by element type with all columns from the reference

The only missing piece is **wiring the OutputsTab export to use this function** instead of CSV.

## Technical Details

**File modified**: `src/components/workspace/OutputsTab.tsx` — patch the `handleExport` for `type === "estimate"`:

1. Fetch `estimate_items` (with segment relation for element grouping)
2. Fetch `bar_items` for all segments in the project
3. Fetch `segments` for element type names
4. Fetch project metadata from `projects` table
5. Build a synthetic `quoteResult` object with `bar_list`, `size_breakdown_kg`, `total_weight_kg`
6. Call `exportExcelFile({ quoteResult, elements: [], scopeData })` 
7. Remove the old CSV logic for estimate

### Data assembly (pseudo):
```
- segments → element types
- estimate_items → weight/size aggregation
- bar_items → detailed bar list rows with size, qty, cut_length, shape, finish
- Compute weights using getMassKgPerM()
- Group bars by segment.segment_type (= element_type)
```

## Files Modified
- `src/components/workspace/OutputsTab.tsx` — replace estimate CSV export with Excel export using existing `exportExcelFile`

## No new files, no migrations

