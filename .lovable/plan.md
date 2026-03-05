

## Plan: Fix Race Condition — Blueprint File URLs Not Passed to AI Analysis

### Root Cause

In `src/components/chat/ChatArea.tsx`, when files are uploaded via the auto-upload flow, there is a React state race condition:

1. **Line 696**: `setUploadedFiles(prev => [...prev, ...newUrls])` queues a state update
2. **Line 785**: `handleModeSelect("smart")` is called in the same synchronous execution
3. **Line 522**: Inside `handleModeSelect`, `uploadedFiles` still holds the **old empty array** because React batches state updates and hasn't re-rendered yet
4. **Result**: `analyze-blueprint` receives `fileUrls: []` — no blueprints, only knowledge files

This is confirmed by the network request showing `"fileUrls":[]` in the `analyze-blueprint` POST body.

### Fix

Pass the `newUrls` (or combined `allUrls`) directly to `handleModeSelect` instead of relying on stale React state. Two changes needed:

1. **Modify `handleModeSelect`** to accept an optional `fileUrlsOverride?: string[]` parameter
2. **In `streamAIResponse` call** (line 522), use `fileUrlsOverride ?? uploadedFiles` so the override takes precedence
3. **At line 785** (auto-detection auto-proceed), pass `allUrls` to `handleModeSelect("smart")` so the freshly-uploaded URLs are used directly

### Files to modify

- **`src/components/chat/ChatArea.tsx`** — 3 small edits:
  1. Add `fileUrlsOverride` parameter to `handleModeSelect` (line ~480)
  2. Use `fileUrlsOverride ?? uploadedFiles` in `streamAIResponse` call (line ~522)
  3. Pass `allUrls` at auto-proceed call site (line ~785)

