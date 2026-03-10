

## Plan: Always Show Quote + Export Buttons at the End (Both Modes)

### Problem
1. The quote result card and export buttons are currently inside the "Cards" tab of `ValidationResults`, so they're hidden when the user switches to Bar List or Bending tabs.
2. Bug: "undefined tons" appears because line 379 renders `total_weight_tons` without a fallback.
3. A stray `0` appears (likely `excluded_count` or similar value rendered without a label).

### Changes

#### 1. Move Quote + Export section outside the Tabs (`src/components/chat/ChatArea.tsx`)
Extract the quote result display + ExportButtons from inside `ValidationResults` and render them **after** the `</Tabs>` block (around line 1554), so they're always visible regardless of which tab is active.

This block will include:
- The quote header (AI Express / Verified badge)
- Weight summary boxes (kg/lbs + tonnes/tons)
- Size breakdown table
- Export buttons (PDF, Excel, Shop Drawing, Share)

Rendered condition: `{quoteResult && quoteResult.quote && (...)}`

#### 2. Remove the quote section from `ValidationResults.tsx`
Remove lines 348–392 (the `{quoteResult && quoteResult.quote && (...)}` block) from `ValidationResults` since it will now live in `ChatArea.tsx` directly.

#### 3. Fix "undefined tons" bug (`ValidationResults.tsx` → now in `ChatArea.tsx`)
- Line 379: Change `{quoteResult.quote.total_weight_tons} tons` to `{(quoteResult.quote.total_weight_tons ?? 0).toLocaleString(undefined, {maximumFractionDigits: 2})} tons`
- Ensure all weight values have proper fallbacks using `?? 0` and `.toLocaleString()`

#### 4. Fix stray "0" display
Add proper conditional rendering so raw numeric values like `excluded_count` don't render as standalone text when they're 0.

### Scope
- 2 files modified: `ChatArea.tsx`, `ValidationResults.tsx`
- ~40 lines moved, ~5 lines fixed
- No backend changes

