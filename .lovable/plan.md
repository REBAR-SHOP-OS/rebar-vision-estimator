

# Fix Reconciliation Sheet TOTAL Mismatch

## Problem
The Reconciliation sheet TOTAL cell shows 13,061 kg (from the AI `recon.drawing_based_total` value) while the individual element rows sum to only 6,155.1 kg. The TOTAL should be the sum of the visible rows, not a separate AI-provided number.

## Root Cause
Line 454 in `src/lib/excel-export.ts` hardcodes `recon.drawing_based_total` into the TOTAL cell. This value comes from the AI response and may be stale or computed differently than the per-element breakdown shown above it.

## Fix

### `src/lib/excel-export.ts` — Use SUM formula for TOTAL row

Replace the hardcoded total values with Excel `SUM()` formulas that reference the actual data rows in columns B and C. This ensures the TOTAL always matches the visible element weights.

- Track the first and last data row numbers during element row insertion
- TOTAL cell B = `=SUM(B{first}:B{last})` instead of `recon.drawing_based_total`
- TOTAL cell C = `=SUM(C{first}:C{last})` instead of `recon.industry_norm_total`
- Keep `recon.variance_pct` and `recon.risk_level` as-is (they are metadata, not sums)

## Files Modified
- `src/lib/excel-export.ts` — Reconciliation sheet TOTAL row uses SUM formulas

