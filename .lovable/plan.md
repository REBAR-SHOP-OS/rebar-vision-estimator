
## Fix: Quick-Action Buttons Send Immediately Without Waiting

### Problem
When clicking a quick-action card (e.g. "Yes, Proceed", "Adjust Scope"), the code calls `setInput(card.sendText)` then `setTimeout(() => sendMessage(), 0)`. But `sendMessage` reads from the `input` state variable, which hasn't updated yet because React state updates are asynchronous. This causes the message to either not send or send the old input value.

### Solution
Add an optional `overrideText` parameter to `sendMessage` so it can accept text directly, bypassing the state. The quick-action buttons will call `sendMessage(card.sendText)` immediately -- no `setInput`, no `setTimeout`.

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/ChatArea.tsx` | 1. Change `sendMessage` signature from `async ()` to `async (overrideText?: string)`. Use `const text = (overrideText ?? input).trim()` instead of `input.trim()` throughout the function. 2. In the card click handler, replace the `setInput` + `setTimeout` + `sendMessage()` pattern with a single direct call: `sendMessage(card.sendText)`. Remove the `autoSend` property entirely since all cards with `sendText` will just call `sendMessage` directly. |

### Before (broken)
```typescript
setInput(card.sendText);
if (card.autoSend) {
  setTimeout(() => {
    sendMessage(); // reads stale `input` state
  }, 0);
}
```

### After (fixed)
```typescript
sendMessage(card.sendText); // sends immediately with the correct text
```
