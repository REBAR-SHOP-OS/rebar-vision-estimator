

## Plan: Suppress false "structured output was not returned" warning when AI correctly blocks estimation

### Problem
When the AI correctly identifies that uploaded files are not blueprints (e.g., a reference card), it returns a well-formed BLOCKED response explaining why. The chat message renders perfectly. However, `processAtomicTruth` returns `false` (no elements — correctly, since there are none to extract), and the code appends a misleading `⚠️ Estimation completed but structured output was not returned` system message.

The AI did its job correctly. The fallback warning is wrong here.

### Fix

**File: `src/components/chat/ChatArea.tsx`** (lines 730-741)

Before showing the fallback warning, check if the AI response contains a BLOCKED status or a clear "no drawings" explanation. If so, skip the warning — the AI's chat message already explains the situation.

```typescript
// Line ~732: Replace the simple !extracted check
if (!extracted) {
  const isIntentionalBlock = /BLOCKED|MISSING_DRAWINGS|no.*project.*drawings|cannot.*produce.*quantities/i.test(fullContent);
  if (!isIntentionalBlock) {
    const fallbackMsg = { ... };
    setMessages((prev) => [...prev, fallbackMsg]);
  }
}
```

One file changed. No other files affected. No data integrity risk.

