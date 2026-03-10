

## Plan: Fix Empty Bubble — Show Thinking Indicator Immediately

### Root Cause (Updated)

The Lovable AI gateway does **not** forward Gemini's reasoning tokens. There is no `delta.reasoning` field in the SSE stream — the gateway buffers reasoning internally and only starts emitting `delta.content` once actual output begins. This means our reasoning-detection code will never trigger.

The fix is simple: show a "Thinking..." indicator in the chat bubble **immediately** when the SSE connection opens, before any tokens arrive. Replace it with real content as soon as the first `delta.content` token streams in.

### Changes

**File: `src/components/chat/ChatArea.tsx`** — 2 small changes

#### 1. Show thinking indicator right after stream opens (~line 391, after `assistantId` is created)

Insert an immediate message with `🧠 *Analyzing blueprints...*` content before the streaming loop begins:

```typescript
const assistantId = crypto.randomUUID();

// Show thinking indicator immediately — gateway buffers reasoning tokens
setMessages((prev) => [
  ...prev,
  {
    id: assistantId,
    role: "assistant" as const,
    content: "🧠 *Analyzing blueprints...*",
    created_at: new Date().toISOString(),
  },
]);
```

#### 2. Remove the dead reasoning-detection code (~lines 426-497, 534-596)

The `reasoningRaw` / `reasoningText` extraction code in both the main parse loop and the flush section is dead code — the gateway never sends these fields. Remove it to keep the codebase clean. The existing `if (content)` block already correctly overwrites the thinking indicator with real content via the `last?.id === assistantId` check.

### Why This Works
- User sees "🧠 Analyzing blueprints..." the instant the connection opens (no more empty bubble)
- Once the first `delta.content` token arrives, the existing `setMessages` logic replaces it with the real streamed text
- No dependency on gateway-specific fields that don't exist
- Removes ~60 lines of dead code

### Scope
- 1 file changed
- ~5 lines added, ~60 lines of dead code removed

