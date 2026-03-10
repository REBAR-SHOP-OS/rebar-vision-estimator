

## Fix: "undefined tons" Display + Missing Tonnes Fields

### Problem
The screenshot shows "undefined tons" in the Verified Quote card. `buildSyntheticQuote` returns `total_weight_kg` and `total_weight_lbs` but never sets `total_weight_tonnes` or `total_weight_tons`, which the UI (`ValidationResults.tsx` line 366-368) tries to display.

### Changes

**File: `src/components/chat/ChatArea.tsx`** (line 663-672)
Add the missing tonnage fields to the synthetic quote return object:
```typescript
total_weight_tonnes: (summary?.total_rebar_weight_kg || totalKg) / 1000,
total_weight_tons: (summary?.total_rebar_weight_lbs || totalKg / 0.453592) / 2000,
```

**File: `src/components/chat/ValidationResults.tsx`** (lines 356-380)
Add null safety so even if fields are missing, it computes from available data instead of showing "undefined":
- Compute tonnes from kg: `(quote.total_weight_kg / 1000).toFixed(2)` as fallback
- Compute tons from lbs: `(quote.total_weight_lbs / 2000).toFixed(2)` as fallback
- Apply optional chaining + `.toLocaleString()` on all weight displays

### Scope
- 2 files: `ChatArea.tsx` (add fields), `ValidationResults.tsx` (null-safe display)
- No backend changes

