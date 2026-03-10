

## Fix: PDF/Excel Export Never Available Because `quoteResult.quote` Is Never Set

### Root Cause

There are **two paths** that set `quoteResult`:

1. **Pricing endpoint** (line 612): `setQuoteResult(data)` — returns `{ quote: { bar_list, size_breakdown, total_weight_lbs, ... } }`. This is what exports need.
2. **Restore/processAtomicTruth** (line 151): `setQuoteResult({ elements, summary })` — has NO `quote` property.

The export system checks `quoteResult?.quote` everywhere:
- Idea cards only show "Download PDF/Excel" when `quoteResult?.quote` exists (lines 1565, 1573)
- `ExportButtons` directly accesses `quoteResult.quote.bar_list` (line 24)
- `ValidationResults` guards ExportButtons with `quoteResult && quoteResult.quote` (line 349)

**The pricing endpoint is never automatically called after the AI generates estimation data.** So `quoteResult.quote` is always undefined, the export buttons never appear, and the user can never download files.

### Fix

**Two changes needed:**

#### 1. Auto-run pricing after `processAtomicTruth` extracts elements (ChatArea.tsx)

After `processAtomicTruth` successfully extracts elements (line 872), automatically call `runPricing` so `quoteResult.quote` gets populated:

```typescript
// After line 872: await processAtomicTruth(fullContent);
// Add: auto-price if elements were extracted and no quote exists
if (validationData?.elements?.length > 0 && !quoteResult?.quote) {
  await runPricing(validationData.elements, calculationMode || 'ai_express');
}
```

#### 2. Build `quoteResult.quote` from atomic truth data when pricing endpoint isn't available (ChatArea.tsx)

When restoring from saved messages or when the AI embeds a full bar list in the atomic truth JSON, construct a `quote` object locally from the atomic data so exports work immediately:

In `processAtomicTruth` and the restore path (line 151), if the atomic data contains `summary` with weight/bar_list info, build a synthetic `quote`:

```typescript
const syntheticQuote = atomicData.summary ? {
  bar_list: atomicData.elements.flatMap(e => 
    e.extraction?.truth?.bar_lines?.map(b => ({
      ...b, element_type: e.element_type, element_id: e.element_id
    })) || []
  ),
  size_breakdown_kg: {},
  total_weight_kg: atomicData.summary.total_rebar_weight_kg || 0,
  total_weight_lbs: atomicData.summary.total_rebar_weight_lbs || 0,
  // ... compute from bar_lines
} : null;

setQuoteResult({ 
  elements: atomicData.elements, 
  summary: atomicData.summary, 
  quote: syntheticQuote 
});
```

#### 3. Add null safety to ExportButtons (ExportButtons.tsx)

Guard against `quoteResult.quote` being undefined to prevent crashes:

```typescript
const barList: any[] = quoteResult?.quote?.bar_list || [];
const sizeBreakdown = quoteResult?.quote?.size_breakdown || {};
// etc.
```

### Scope
- 2 files modified: `ChatArea.tsx` (auto-pricing + synthetic quote), `ExportButtons.tsx` (null safety)
- No new files, no backend changes

