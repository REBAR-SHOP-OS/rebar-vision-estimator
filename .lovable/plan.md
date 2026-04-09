

# Fix: Size Breakdown Not Matching Element Breakdown

## Problem
The "Weight Summary by Bar Size" column sums to ~18,024 kg while the "Element-wise Summary" sums to ~8,911 kg. Both should match since they represent the same data sliced differently.

**Root cause**: The size breakdown reads from `quoteResult.quote.size_breakdown_kg` — a stale AI-provided dictionary — while the element breakdown is computed live from the actual `bar_list` items. These two sources are out of sync.

## Fix

### `src/lib/excel-export.ts` — Compute size breakdown from bar_list

Replace lines 76-86 (which read from `size_breakdown_kg` / `size_breakdown`) with logic that computes weight-by-size directly from the `barList` array, using each item's `size` and `weight_kg` — the same data source used for the element breakdown.

```text
Current flow:
  Size column  ← quoteResult.quote.size_breakdown_kg (stale AI value)
  Element column ← barList[].weight_kg (actual data)

Fixed flow:
  Size column  ← barList[].weight_kg grouped by size (actual data)
  Element column ← barList[].weight_kg grouped by element_type (actual data)
```

This ensures both columns sum to the same Grand Total since they derive from the identical source array.

## Files Modified
- `src/lib/excel-export.ts` — lines 76-86 only (replace size breakdown computation)

