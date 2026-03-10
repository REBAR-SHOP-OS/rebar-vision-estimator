

## Plan: Fix Empty Chat Bubble — Handle Gemini Reasoning Tokens

### Root Cause
The Gemini 2.5 Pro model sends its response in two phases:
1. **Reasoning phase**: `delta.content = ""` with actual thinking text in `delta.reasoning`
2. **Content phase**: `delta.content = "actual response text"`

The streaming parser in `ChatArea.tsx` (line 412) only reads `delta.content`. During the reasoning phase (which can last 30-60+ seconds for complex blueprints), `fullContent` stays empty. The user sees an empty chat bubble with no indication of progress — it looks frozen.

### Changes

**File: `src/components/chat/ChatArea.tsx`** — 2 changes in the streaming parser

#### 1. Show reasoning text as a progress indicator during thinking phase (~line 410-448)

When `delta.content` is empty but `delta.reasoning` exists, show a thinking indicator in the message bubble. Don't append reasoning to `fullContent` (that's only for the final content), but update the displayed message with a "Thinking..." status and the reasoning summary.

```
// Inside the SSE parse loop:
const content = parsed.choices?.[0]?.delta?.content;
const reasoning = parsed.choices?.[0]?.delta?.reasoning;

if (content) {
  fullContent += content;
  // ... existing display logic
} else if (reasoning && !fullContent) {
  // Still in thinking phase — show progress indicator
  // Extract the bold header from reasoning (e.g., "**Estimating Rebar Quantities**")
  const headerMatch = reasoning.match(/\*\*(.+?)\*\*/);
  const thinkingLabel = headerMatch ? headerMatch[1] : "Analyzing...";
  setMessages(prev => {
    const last = prev[prev.length - 1];
    if (last?.id === assistantId) {
      return prev.map(m => m.id === assistantId ? { ...m, content: `🧠 *${thinkingLabel}*` } : m);
    }
    return [...prev, { id: assistantId, role: "assistant", content: `🧠 *${thinkingLabel}*`, created_at: new Date().toISOString() }];
  });
}
```

#### 2. Apply same logic in the flush section (~line 462-485)

Same dual-check for `content` vs `reasoning` in the buffer flush loop.

### Why this fixes the "freeze"
- Users immediately see the AI is working ("Estimating Rebar Quantities", "Reviewing the Blueprint Data", etc.)
- Once actual content starts streaming, it overwrites the thinking indicator
- `fullContent` only contains real content (not reasoning), so `processAtomicTruth` and `handlePostStream` work correctly
- No backend changes needed

### Scope
- 1 file: `src/components/chat/ChatArea.tsx`
- ~15 lines changed in the streaming parser
- No backend changes

