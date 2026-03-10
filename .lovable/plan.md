

## Plan: VERIFIED_QUOTE_TOTALS_BINDING_FIX (v2026.03.UI_TOTALS_FIX)

### Root Causes

1. **"undefined tons"**: The tonnes display at line 1656-1658 chains through `total_weight_tonnes` → `total_weight_kg / 1000` → `total_weight_tons`. When a Verified Quote has only `total_weight_lbs` (no `_kg`, no `_tonnes`), the first branch returns `null`, the fallback computes `total_weight_tons` which may also be `undefined`, producing "undefined tons".

2. **Stray "0"**: Line 1663 uses `{quoteResult.quote.total_weight_kg && (...)}`. When `total_weight_kg` is exactly `0` (falsy number), React renders the literal `0` instead of `null`. Classic React gotcha.

### Changes — Single File: `src/components/chat/ChatArea.tsx`

**Lines ~1645-1672** — Replace the totals rendering block:

- Create normalized totals before the JSX:
  ```
  const q = quoteResult.quote;
  const totalLbs = q.total_weight_lbs || 0;
  const totalKg = q.total_weight_kg || (totalLbs * 0.453592);
  const totalTonnes = q.total_weight_tonnes ?? q.total_tonnes ?? (totalKg / 1000);
  const totalTons = q.total_weight_tons ?? (totalLbs / 2000);
  ```

- Primary cards: show kg if `totalKg > 0`, else lbs. Tonnes card always derives from the resolved value — never "undefined".

- Fix stray "0": Change `{quoteResult.quote.total_weight_kg && (...)}` to `{totalKg > 0 && (...)}` (boolean check, never renders falsy number).

- Secondary row (lbs/tons alternates) uses the same resolved values.

### Scope
- 1 file patched: `src/components/chat/ChatArea.tsx` (~25 lines changed)
- No new files, no backend changes, no styling changes

