

## Fix: Overhaul Weight Calculation Pipeline for Accuracy

### The Problem
Your app estimated **234.86 lbs** for a project that is actually **44,777 kg (98,720 lbs)**. That is 420x too low. The issue is architectural -- three systems are broken.

### Root Causes

1. **One bar group per element**: The data schema only allows a single `vertical_bars: {size, qty}` per element. A real raft slab has 12+ bar lines (20M@12" BLL, 20M@12" BUL, chair bars, step bars, dowels, etc.). Everything past the first line is lost.

2. **Fake lengths**: The pricing function uses hardcoded lengths (e.g., raft slab = 10 ft) instead of actual lengths from the blueprint (e.g., 57 ft, 97 ft). This alone causes 5-10x undercount.

3. **Too few elements**: Instead of extracting ~80 individual bar lines, the AI creates 2-3 summary elements. Coverage is under 5%.

### The Fix (3 parts)

---

**Part 1: Add `bar_lines` array to ElementUnit schema**

In `analyze-blueprint/index.ts`, update the `ELEMENT_UNIT_SCHEMA` to add a `bar_lines` array inside `extraction.truth`:

```text
"bar_lines": [
  {
    "mark": "20M @ 12\" OC",
    "size": "20M",
    "multiplier": 2,
    "qty": 87,
    "length_mm": 17437,
    "shape": "straight",
    "info": "BLL & TUL",
    "weight_kg": 7145.16
  },
  ...more lines
]
```

This replaces the single `vertical_bars`/`ties` fields as the primary data source. Keep `vertical_bars`/`ties` as fallback for backward compatibility.

Update the prompt instructions to tell the AI: "For EVERY bar line you find in the blueprint, schedules, or details, create a separate entry in `bar_lines`. Do NOT summarize multiple bar lines into one."

---

**Part 2: Rewrite price-elements to use bar_lines**

In `price-elements/index.ts`, change `calculateElementWeight()`:

1. Check if `truth.bar_lines` array exists and has entries
2. If yes: compute weight from actual data:
   - For each bar line: `weight = multiplier x qty x (length_mm / 1000) x mass_kg_per_m`
   - Or if length is in feet: `weight = multiplier x qty x length_ft x weight_lb_per_ft`
3. If no bar_lines (backward compat): fall back to current hardcoded-length logic
4. Output totals in both kg and lbs

---

**Part 3: Update AI prompt for exhaustive bar-line extraction**

In `analyze-blueprint/index.ts`, add a new mandatory rule to the pipeline instructions:

```text
## BAR-LINE-LEVEL EXTRACTION (MANDATORY)
For every element, you MUST extract EVERY individual bar line you find.
Each bar line is a separate row in the estimation spreadsheet.

A "bar line" is one specification like:
  "20M @ 12" OC" with multiplier=2, qty=87, length=17437mm

DO NOT summarize. If a raft slab has 12 different bar specifications, 
output 12 entries in bar_lines.

For each bar line extract:
- mark: the specification text (e.g., "20M @ 12\" OC")
- size: bar size (e.g., "20M" or "#5")
- multiplier: layer multiplier (1 or 2 for top+bottom)
- qty: number of bars
- length_mm: individual bar length in millimeters
- length_ft: individual bar length in feet (if given in imperial)
- shape: straight, bend, L-bend, U-bend, hook
- info: placement info (BLL, TUL, BUL, TLL, DOWELS, VERT, HOR, etc.)
- sheet_ref: which sheet/detail this came from
```

---

### Technical Details

| File | Change |
|---|---|
| `supabase/functions/analyze-blueprint/index.ts` | Add `bar_lines` array to ELEMENT_UNIT_SCHEMA; add BAR-LINE-LEVEL EXTRACTION mandatory rule to PIPELINE_INSTRUCTIONS; update Step 5 and Step 6 instructions |
| `supabase/functions/price-elements/index.ts` | Rewrite `calculateElementWeight()` to use `truth.bar_lines` array with real lengths/quantities; fall back to old logic only when bar_lines is empty; output dual units (kg + lbs) |
| `src/components/chat/SizeBreakdownTable.tsx` | Add kg column alongside lbs for Canadian metric projects |

### Expected Outcome

For the 20 York Valley project:
- Before: 234.86 lbs (0.117 tons)
- After: Should approach 98,720 lbs / 44,777 kg (44.78 tons)
- The accuracy depends on how many bar lines the AI extracts from the blueprint images, but the architecture will no longer be the bottleneck

### What Stays the Same
- Detection V2 pipeline (primaryCategory, features, veto logic)
- ScopeDefinitionPanel UI
- Estimation group filtering (loose vs cage)
- Export/PDF/shop drawing features
- Authentication and database

