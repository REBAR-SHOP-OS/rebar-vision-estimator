

# Add Provenance Notes to Weight Calculation Breakdown

## Problem
The Weight Calculation Breakdown box shows the math (Qty × Length × Mass = Weight) but doesn't explain **where** those numbers came from — which estimate item, which source file, what confidence level, or how the AI determined each value.

## Current Data Flow
```text
Drawing PDF → auto-estimate → estimate_items (with source_file_id) → auto-bar-schedule (AI) → bar_items
```

Key facts from the database:
- `bar_items` have `confidence` (0.85–0.9) but NO `estimate_item_id` link (all null)
- `estimate_items` have `source_file_id` linking to the drawing file and `description` explaining the structural element
- The AI generates bar marks from estimate items but doesn't store which estimate item produced which bar mark
- The segment has `level_label`, `zone_label`, `segment_type`

## Changes

### 1. `supabase/functions/auto-bar-schedule/index.ts` — Link bar items to estimate items
Add `estimate_item_id` to each generated bar item by:
- Passing estimate item IDs to the AI prompt alongside descriptions
- Asking the AI to return which `estimate_item_index` each bar came from
- Mapping the index back to the actual `estimate_item.id` before insert

### 2. `src/pages/SegmentDetail.tsx` — Add provenance notes to breakdown box
Below each bar line in the breakdown, show:
- **Source**: the estimate item description (e.g., "Continuous Wall Footing - Longitudinal Reinforcement")
- **Drawing**: the source file name (from the linked estimate item's `source_file_id`)
- **Confidence**: the bar item's confidence score as a percentage
- **Process**: "AI-generated from estimate via auto-bar-schedule" or "Manually entered"

Also add a header note: "Data pipeline: Drawing → Auto-Estimate → Auto-Bar-Schedule → Weight Calculation"

### 3. Data joining approach
Since most bar items currently lack `estimate_item_id`, use a **best-match heuristic** in the UI:
- Match bar item `size` to estimate item `bar_size`
- If multiple matches, show all possible sources
- Going forward, new bar schedules will have the proper link

## Files Modified
- `supabase/functions/auto-bar-schedule/index.ts` — add estimate_item_id mapping
- `src/pages/SegmentDetail.tsx` — add provenance info to breakdown box

## No new files, no migrations

