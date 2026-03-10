

## Plan: Fix Export Tiles Not Appearing After Estimation

### Root Cause Analysis

After tracing both the Smart and Step-by-Step flows, there are two issues causing export tiles to not appear reliably:

**Issue 1: Idea cards (bottom input area) — condition too restrictive**
The "Download PDF" and "Download Excel" idea cards at the bottom of the chat (lines 1989-2000) only appear when:
- Input is empty AND not loading
- AND the last assistant message matches a specific regex (confirm question) OR `validationData/quoteResult` exists
- AND `quoteResult?.quote` is truthy

The problem: after step-by-step conversation, the last assistant message might not match `hasConfirmQuestion`, so it falls to the `validationData || quoteResult` branch (line 1994). But if the user types anything in the input box, all idea cards vanish (`!input.trim()` check at line 1974).

**Issue 2: Inline ExportButtons scroll visibility**
The `ExportButtons` component (line 1881) renders inside the results panel after the quote weight summary. Users must scroll down past the validation cards, bar list tabs, and weight summary to reach it. There's no persistent/floating export action.

### Fix

**1. Always show export idea cards when `quoteResult?.quote` exists** (ChatArea.tsx, ~10 lines)
Add a dedicated always-visible export card row that shows whenever `quoteResult?.quote` exists, independent of the other conditional logic. Place it above the suggestion cards area so it's always visible.

**2. Add auto-scroll to ExportButtons after quote is set** (ChatArea.tsx, ~5 lines)
When `quoteResult` is first set (in `processAtomicTruth` and `runPricing`), scroll the export buttons into view using a ref + `scrollIntoView()`.

**3. Ensure idea cards show even during input** (ChatArea.tsx, ~3 lines)  
For export-specific cards only, relax the `!input.trim()` condition — always show Download PDF/Excel cards when a quote exists, even if the user has text in the input.

### Scope
- 1 file modified: `src/components/chat/ChatArea.tsx`
- ~20 lines changed across 3 locations
- No backend changes

