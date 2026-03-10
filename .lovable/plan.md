

## Plan: Clean Up Raw JSON from Chat Messages

### Problem
Raw JSON data (element objects with "Estimation Group", "Element Type", etc.) appears in chat bubbles because existing regex only strips complete `%%%ATOMIC_TRUTH_JSON_START/END%%%` blocks. During streaming or when markers are missing, JSON is visible.

### Changes

**1. `src/components/chat/ChatMessage.tsx`** — Enhance `displayContent` filters (~line 18-23)

Add these regex patterns after existing ones:
- `%%%ATOMIC_TRUTH_JSON_START%%%[\s\S]*` — strip partial atomic blocks (no end marker yet)
- `` ```json[\s\S]*?``` `` — strip JSON code blocks
- Bare JSON objects with element keys (`Estimation Group`, `element_type`, `Rebar Size`, `bar_lines`) — strip to end of string
- Clean up empty code block artifacts

**2. `src/components/chat/ChatArea.tsx`** — Add `cleanForDisplay` helper

- Create a helper function with the same stripping logic
- During streaming, set `content: cleanForDisplay(fullContent)` instead of raw `fullContent`
- Keep raw `fullContent` for `processAtomicTruth` parsing

### Scope
- 2 files modified
- ~20 lines changed
- No backend changes

