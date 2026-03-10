

## Fix: Export Buttons Showing Before Pricing is Complete

### Problem
The "Download PDF" and "Download Excel" cards appear whenever `quoteResult` is truthy (line 1565), but the export handlers require `quoteResult.quote` to exist (line 1606/1613). There are two cases where `quoteResult` exists without `.quote`:
1. **Restored projects** set `quoteResult = { elements, summary }` (line 151)
2. **Mid-estimation** — `quoteResult` may be set before pricing completes

This causes the buttons to render but show "Complete estimation first" when clicked.

### Fix

**File: `src/components/chat/ChatArea.tsx`** — 1 line change

Change line 1565 from:
```typescript
...(quoteResult ? [
```
to:
```typescript
...(quoteResult?.quote ? [
```

This ensures the Download PDF and Download Excel cards only appear when actual pricing data (with `bar_list`, `size_breakdown`, etc.) is available — not just when a partial `quoteResult` object exists.

### Scope
- 1 file, 1 line changed

