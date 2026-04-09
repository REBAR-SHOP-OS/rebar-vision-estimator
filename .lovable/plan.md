

# Fix Excel Export: Total Mismatch, Missing Mesh, Inflated Bar List Weight

## Problems Found

### Bug 1: Grand Total (13,061 kg) ignores visible rows
**Line 89**: `totalKg` is set from `recon.drawing_based_total` (the AI's stale number) instead of summing `sizeEntries` or `elemEntries`. The visible element rows sum to ~6,155 kg but the yellow total shows 13,061.

**Fix**: Compute `totalKg` as the sum of actual `elemEntries` values (or `sizeEntries`, whichever is larger), not from `recon.drawing_based_total`.

### Bug 2: Mesh Details always shows "N/A"
**Line 65**: `meshDetails` reads from `quoteResult.quote.mesh_details` or `scopeData?.meshDetails`. But WWM items are stored as `estimate_items` with `item_type = 'wwm'`, not in a separate `mesh_details` array. Since neither source is populated, the mesh table always shows N/A — even though the size breakdown correctly includes "6x6-W2.9/W2.9" (751 kg).

**Fix**: Extract mesh items from the `bar_list` array where the size matches a WWM pattern (contains "W" and "/" like "6x6-W2.9/W2.9"). Build mesh detail rows from these items, showing their element_type as location, size, and computed area.

### Bug 3: Bar List sheet total = 63,853.9 kg (5x too high)
**Line 334-340**: For each bar item, weight is recalculated as `totalPieces * lengthMm / 1000 * massKgM`. If the AI already set `weight_kg` on each bar item, this value is used directly. But if `weight_kg` is not a number and the length/qty values are inflated from AI hallucination, the bar list sheet produces a wildly different total than the summary sheet.

**Fix**: When `weight_kg` is a valid number on the bar item, use it directly and back-calculate `totalLenM` from it (for display consistency). Only fall back to the length-based calculation when `weight_kg` is missing. This ensures the Bar List total matches the Estimate Summary total.

## Changes — `src/lib/excel-export.ts`

1. **Line 89**: Replace `recon.drawing_based_total` fallback with a computed sum from `elemEntries` (the actual visible row data).

2. **Lines 62-65**: After building `barList`, extract WWM items by checking if `b.size` matches a mesh pattern (contains "W" and "x"). Build `meshDetails` from these if the existing array is empty.

3. **Lines 334-345**: When `b.weight_kg` is a valid number, use it directly and derive `totalLenM = wtKg / massKgM` for display. Only compute from qty/length when `weight_kg` is missing.

## Files Modified
- `src/lib/excel-export.ts` — 3 targeted patches (no structural changes)

