

## Audit: Calculation Pipeline — Obstacles and Fixes

### Full Calculation Flow (for your engineer)

```text
┌─────────────────────────────────────────────────────────┐
│  1. BLUEPRINTS IN (PDF/images)                          │
│     └─ OCR via Google Vision (3-pass parallel)          │
│     └─ Text extraction (pdfjs-dist)                     │
├─────────────────────────────────────────────────────────┤
│  2. AI ESTIMATION (analyze-blueprint edge function)     │
│     └─ System prompt instructs AI to output:            │
│        - elements[] with bar_lines[] per element        │
│        - Each bar_line: size, qty, multiplier,          │
│          length_mm or length_ft, shape                  │
│     └─ AI told: weight = qty × length × unit_weight    │
│     └─ Output wrapped in %%%ATOMIC_TRUTH_JSON%%% markers│
├─────────────────────────────────────────────────────────┤
│  3. CLIENT PARSING (ChatArea.tsx)                       │
│     └─ extractAtomicTruthJSON() parses the JSON         │
│     └─ buildSyntheticQuote() recomputes weights:        │
│        For each bar_line:                               │
│          lengthMm = b.length_mm || (b.length_ft×304.8)  │
│          totalLenM = (qty × mult × lengthMm) / 1000    │
│          massKgM = getMassKgPerM(b.size)    ← CORRECT   │
│          weight = totalLenM × massKgM                   │
│        Fallback: use b.weight_kg if already set         │
├─────────────────────────────────────────────────────────┤
│  4. VALIDATION (validate-elements edge function)        │
│     └─ 6 gates: Identity, Completeness, Consistency,   │
│        Scope, Unit (G5), Coating (G6)                   │
│     └─ Status: READY / FLAGGED / BLOCKED                │
│     └─ Does NOT recalculate weights                     │
├─────────────────────────────────────────────────────────┤
│  5. PRICING (price-elements edge function)              │
│     └─ calculateElementWeight() recomputes weights:     │
│        PRIMARY: bar_lines with length_mm:               │
│          weight_kg = mult × qty × (length_mm/1000)      │
│                      × getMassKgPerM(size)              │
│        FALLBACK: bar_lines with length_ft:              │
│          weight_lbs = mult × qty × length_ft            │
│                       × getWeightPerFt(size)            │
│        LAST: use pre-computed b.weight_kg               │
│     └─ Applies coating multiplier (Epoxy 1.2×, etc.)   │
│     └─ Aggregates: total_weight_kg, total_weight_lbs,  │
│        size_breakdown, bar_list                         │
├─────────────────────────────────────────────────────────┤
│  6. DISPLAY (ChatArea.tsx quote panel)                  │
│     └─ Numeric safety: Number() || 0 fallbacks         │
│     └─ Derives tonnes = kg/1000, tons = lbs/2000       │
│                                                         │
│  7. EXPORT (excel-export.ts / pdf-export.ts)            │
│     └─ Bar List sheet recomputes per-row:               │
│        totalLenM = (qty×mult×lengthMm)/1000             │
│        wtKg = b.weight_kg ?? totalLenM × massKgM       │
│     └─ Summary sheet uses recon total or quote total    │
└─────────────────────────────────────────────────────────┘
```

### Weight Tables Used (4 locations — should be 1)

| Location | File | Metric 20M kg/m | Imperial #4 lb/ft | Source |
|---|---|---|---|---|
| **Canonical** | `rebar-weights.ts` | **2.355** ✅ | **0.668** ✅ | CSA G30.18 |
| price-elements | edge function | **2.355** ✅ | **0.668** ✅ | Correct copy |
| BarListTable | component | imports from canonical ✅ | ✅ | Correct |
| **ReviewReport** | component | **1.582** ❌ WRONG | 0.668 ✅ | Old buggy table |

### CRITICAL BUG: ReviewReport.tsx has wrong metric weights

`ReviewReport.tsx` line 11 has a completely different, **incorrect** metric weight table:

```
"10M": 0.527    ← should be 0.785 (off by 33%)
"15M": 1.055    ← should be 1.570 (off by 33%)  
"20M": 1.582    ← should be 2.355 (off by 33%)
"25M": 2.637    ← should be 3.925 (off by 33%)
"30M": 3.692    ← should be 5.495 (off by 33%)
"35M": 5.274    ← should be 7.850 (off by 33%)
"45M": 7.914    ← should be 11.775 (off by 33%)
"55M": 13.186   ← should be 19.625 (off by 33%)
```

These old values appear to be **lb/ft converted incorrectly** — they're roughly `correct_kg_m × 0.67197` (i.e., the lb/ft equivalents mislabeled as kg/m). This means any review report using metric sizes shows weights ~33% too low.

However, `ReviewReport.tsx` doesn't currently use `REBAR_UNIT_WEIGHT` for calculations — it just displays `reviewData` values passed in. The table is dead code but a maintenance trap.

### Other Calculation Observations

1. **buildSyntheticQuote prefers AI weight over recomputed weight**: Line 839 uses `b.weight_kg` if it exists and is > 0, falling back to deterministic recomputation. This means if the AI hallucinates a weight, it gets used. The pricing service (price-elements) does the same at line 147. **Recommendation**: Always recompute deterministically; use AI weight only as a cross-check.

2. **Summary total prefers AI summary over bar-line sum**: Line 850 `total_weight_kg: summary?.total_rebar_weight_kg || totalKg`. If the AI provides a summary total that doesn't match the bar-line sum, the AI's number wins. This can cause the displayed total to disagree with the sum of the bar list.

3. **Excel export has a third independent weight computation**: `excel-export.ts` line 340 recomputes `wtKg` per row but also falls back to `b.weight_kg` (line 340). This can diverge from the synthetic quote if bar objects were mutated.

### Proposed Fixes

**Fix 1: Remove dead wrong weight table from ReviewReport.tsx** (~2 lines)
- Delete `REBAR_UNIT_WEIGHT` constant. If ever needed, import from `rebar-weights.ts`.

**Fix 2: Always recompute weight deterministically, use AI weight only for cross-check** (~10 lines in `buildSyntheticQuote`)
- Change logic: always use `computedWt`, log a warning if AI weight differs by >5%.

**Fix 3: Always use bar-line sum for totals, not AI summary** (~3 lines in `buildSyntheticQuote`)
- Change `total_weight_kg: totalKg` (remove the `summary?.total_rebar_weight_kg ||` fallback).
- Same for `total_weight_lbs`.

**Fix 4: Same deterministic-first logic in price-elements edge function** (~5 lines)
- Already mostly correct, but line 147 falls back to `line.weight_kg` when no length is provided. Add a warning log when this happens.

### Files to Change
- `src/components/review/ReviewReport.tsx` — remove wrong weight table
- `src/components/chat/ChatArea.tsx` — fix buildSyntheticQuote to always recompute
- `supabase/functions/price-elements/index.ts` — add warning log for weight fallback

### Summary for Engineer

The core formula is correct everywhere it's applied:
```
weight_kg = qty × multiplier × (length_mm / 1000) × mass_kg_per_m(size)
```

The weight tables (CSA G30.18 metric, ASTM A615 imperial) are correct in the canonical source and the pricing service. The bugs are:
1. A dead-but-wrong weight table in ReviewReport (33% underweight for metric)
2. Preferring AI-provided weights/totals over deterministic recomputation (trust issue)
3. Three independent recomputation points that could diverge

