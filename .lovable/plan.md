

# Add Segment Summary & Rebar Weight to Bar Schedule Tab

## What Changes

### 1. Add computed Weight column to Bar Schedule table
Currently the bar items table shows Mark, Size, Shape, Cut Length, Qty, Finish, Confidence — but no weight. Using the existing `rebar-weights.ts` utilities (`getMassKgPerM`, `computeItemWeightKg`), compute and display weight per bar row and a total at the bottom.

### 2. Add segment summary cards to Bar Schedule tab
Mirror the summary cards from the Estimate tab but focused on bars: total bar count, total computed weight (kg), total cut length, and bar size breakdown.

## Technical Details

**File modified**: `src/pages/SegmentDetail.tsx` (minimal patch)

### Changes:
1. Import `getMassKgPerM` from `@/lib/rebar-weights`
2. Add a helper function to compute weight per bar: `qty * (cut_length_mm / 1000) * getMassKgPerM(size)` → result in kg
3. Add summary cards above the bar table showing:
   - Total bars count
   - Total quantity (sum of all qty)
   - Total weight (kg, computed)
   - Unique sizes used
4. Add a "Weight (kg)" column to the bar table between Finish and Confidence
5. Add a totals footer row

No new files. No migrations. No edge function changes. Patch-only to SegmentDetail.tsx.

