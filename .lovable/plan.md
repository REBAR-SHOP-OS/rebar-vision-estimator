

## Plan: Fix Freezing and Make Both Modes Consistent

### Root Cause of Freezing
`subStep` is set to `"parsing"` when estimation starts but **never cleared** when:
- `processAtomicTruth` returns `false` (no elements found — the exact error in your console log)
- An error is thrown in the catch block
- The response is truncated

This leaves the "Parsing / Validating / Ready" progress indicator stuck permanently.

### Root Cause of Inconsistency
The two modes (`handleModeSelect` for initial run vs `sendMessage` for follow-ups) have divergent post-streaming logic. `sendMessage` doesn't set/clear `subStep`, doesn't show fallback messages on failure, and doesn't properly handle the pipeline the same way.

### Changes (1 file: `src/components/chat/ChatArea.tsx`)

#### Fix 1: Clear `subStep` on all failure paths (~4 locations)

In `handleModeSelect`:
- After `processAtomicTruth` returns false (line 830): add `setSubStep(null)`
- In catch block (line 850): add `setSubStep(null)`

In `sendMessage`:
- After `processAtomicTruth` (line 939): if it returns false, add `setSubStep(null)`
- In catch block (line 948): add `setSubStep(null)`

#### Fix 2: Unify post-streaming logic into a shared helper

Extract the duplicated code from `handleModeSelect` (lines 815-849) and `sendMessage` (lines 928-947) into a single `handlePostStream` function:

```text
async function handlePostStream(fullContent, chatHistory, mode) {
  triggerLearning(...)
  save assistant message to DB
  const extracted = await processAtomicTruth(fullContent)
  if (!extracted) {
    setSubStep(null)          // <-- KEY FIX
    show fallback if not intentional block
  }
  check finder pass candidates
}
```

Both `handleModeSelect` and `sendMessage` call this same function after `streamAIResponse`.

#### Fix 3: Clean content in flush section (line 475-476)

Apply the same `cleanForDisplay` filter in the buffer flush section so raw JSON doesn't flash at the end of streaming.

#### Fix 4: Always reset `subStep` alongside `setLoading(false)`

Add `setSubStep(null)` next to every `setLoading(false)` call to guarantee cleanup.

### Scope
- 1 file: `ChatArea.tsx`
- ~30 lines changed (extract shared helper, add cleanup calls)
- No backend changes

