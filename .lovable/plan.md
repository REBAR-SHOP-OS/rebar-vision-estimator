

# Make Segments List Show Real Computed Data

## Problem
The Segments tab shows "—" for confidence and "not ready" for drawing on every row because these values are never computed or updated. The bar schedule weight column and summary cards already exist in code but weight shows "—" because AI-generated bar sizes (e.g. "25M") must match the rebar-weights lookup table exactly.

## What Changes

### 1. Segments Tab — Show live weight and bar count per segment
Add two new columns to the segments table: **Bars** (count) and **Weight (kg)** (computed). These are fetched by querying `bar_items` and `estimate_items` grouped by segment_id when the segments list loads.

**File**: `src/components/workspace/SegmentsTab.tsx`
- After loading segments, run a single query to fetch `bar_items` for all segment IDs: `select segment_id, size, quantity, cut_length from bar_items where segment_id in (...)`
- Compute weight per segment using `getMassKgPerM` from `@/lib/rebar-weights`
- Also fetch `estimate_items` count per segment
- Add two columns to the table between Status and Confidence: **Items** and **Weight (kg)**
- Update segment confidence: compute as the average confidence of its estimate_items (update the segment row after auto-estimate runs)

### 2. Auto-compute segment confidence after auto-estimate
When `auto-estimate` edge function creates items with confidence values, update the parent segment's `confidence` field to the average of its items' confidence.

**File**: `supabase/functions/auto-estimate/index.ts` — add a final UPDATE to set `segments.confidence` to the avg of inserted items' confidence.

### 3. Update drawing_readiness after drawing generation
When a drawing view is created for a segment, update `segments.drawing_readiness` from "not_ready" to "draft".

**File**: `src/components/workspace/DrawingViewsPanel.tsx` — after successful drawing creation, update the segment's `drawing_readiness` to `"draft"`.

## Technical Details

### SegmentsTab.tsx changes (minimal patch)
- Import `getMassKgPerM` from `@/lib/rebar-weights`
- Add state: `segmentStats: Record<string, { bars: number, weightKg: number, items: number }>`
- After segments load, batch-fetch bar_items and estimate_items for all segment IDs
- Compute per-segment weight client-side using the weight lookup
- Render two new `<th>` / `<td>` columns in the table

### auto-estimate edge function (1-line addition)
After inserting estimate items, run:
```sql
UPDATE segments SET confidence = (
  SELECT AVG(confidence) FROM estimate_items WHERE segment_id = $1
) WHERE id = $1
```

### DrawingViewsPanel.tsx (1-line addition)
After successful drawing view insert, run:
```sql
UPDATE segments SET drawing_readiness = 'draft' WHERE id = $segmentId AND drawing_readiness = 'not_ready'
```

## Files Modified
- `src/components/workspace/SegmentsTab.tsx` — add Items + Weight columns with live computation
- `supabase/functions/auto-estimate/index.ts` — update segment confidence after insert
- `src/components/workspace/DrawingViewsPanel.tsx` — update drawing_readiness on generate

## No New Files, No Migrations

