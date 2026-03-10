

## Audit Report: All Identified Issues in ChatArea Pipeline

### Issue 1: **Pipeline completes but shows no results (CRITICAL — this is what you're seeing)**
**Root cause:** The AI response must contain `%%%ATOMIC_TRUTH_JSON_START%%%` and `%%%ATOMIC_TRUTH_JSON_END%%%` markers for `processAtomicTruth()` to extract structured data and call `runValidation()`. If the AI doesn't emit these markers (due to incomplete OCR data, prompt issues, or edge function timeouts), `validationData` stays `null` and the results UI never renders. There is **zero fallback** — the user sees a completed progress bar with no output.

**Fix:** After `processAtomicTruth` returns, check if `validationData` is still null. If so, attempt to parse the AI response for any JSON block (fallback regex), and if that also fails, show a system message: "Estimation completed but structured output was not returned. Please retry or adjust scope."

---

### Issue 2: **OCR failures silently swallowed**
Console shows `FunctionsFetchError: Failed to send a request to the Edge Function` for page 2 OCR. The `catch` block at line 278 just logs to console — no user notification, no retry. If multiple pages fail OCR, the AI receives incomplete text and may produce garbage output.

**Fix:** Track OCR failure count. If >50% of pages fail OCR, show a warning toast and add a system message noting incomplete OCR coverage before proceeding.

---

### Issue 3: **No state restoration on page reload**
When messages are loaded from the DB on reload (`loadMessages`), the code restores `calculationMode` but **never** restores `validationData`, `quoteResult`, `scopeData`, or `uploadedFiles` signed URLs properly. This means refreshing the page after a completed estimation shows only chat text — all structured results are lost.

**Fix:** After loading messages, scan assistant messages for `%%%ATOMIC_TRUTH_JSON_START%%%` markers and re-run `processAtomicTruth` on the last one found. Alternatively, persist validation/quote results to a DB table.

---

### Issue 4: **Edge function auth uses anon key, not user JWT**
Line 310: `Authorization: Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` — all edge function calls (`analyze-blueprint`, `validate-elements`, `price-elements`, `detect-project-type`) use the anon key instead of the user's session token. This means edge functions can't identify the user and RLS-protected queries inside them will fail.

**Fix:** Get the session token via `supabase.auth.getSession()` and use it in the Authorization header (already done correctly in `handleFileUpload` at line 759).

---

### Issue 5: **Signed URLs expire after 1 hour, pipeline can exceed that**
`loadUploadedFiles` creates signed URLs with `3600` second expiry (line 156). Long estimation pipelines (OCR + AI streaming + validation + pricing) can easily exceed 1 hour, causing subsequent edge function calls to receive expired URLs.

**Fix:** Increase signed URL expiry to 7200+ seconds, or refresh URLs before each pipeline stage.

---

### Issue 6: **No timeout on AI streaming**
`streamAIResponse` reads from the stream indefinitely with no timeout. If the edge function hangs or the connection drops silently, the UI stays in loading state forever with no recovery.

**Fix:** Add an `AbortController` with a 5-minute timeout.

---

### Issue 7: **`streamAIResponse` useCallback has stale closure**
Line 423: `useCallback` depends only on `[onStepChange]` but accesses `scopeDataRef`, `projectId`, `user` via closure. While `scopeDataRef` is a ref (safe), `projectId` changes could cause stale references.

**Fix:** Add `projectId` to the dependency array or use a ref for it.

---

### Recommended Fix Priority

| Priority | Issue | Impact |
|----------|-------|--------|
| P0 | #1 No fallback when AI doesn't return markers | User sees stuck UI |
| P0 | #3 No state restoration on reload | Results lost on refresh |
| P1 | #2 Silent OCR failures | Incomplete estimation data |
| P1 | #4 Anon key auth on edge functions | Security + RLS failures |
| P1 | #6 No stream timeout | UI hangs forever |
| P2 | #5 Signed URL expiry | Intermittent failures |
| P2 | #7 Stale closure | Edge case bugs |

### Implementation Plan

**File: `src/components/chat/ChatArea.tsx`** — All fixes in this single file:

1. **P0 — Fallback for missing markers:** In `handleModeSelect` (after line 637 `processAtomicTruth`), add a check: if `validationData` is still null after processing, try a generic JSON extraction from the response, and if that fails too, add a system message with a "Retry" button.

2. **P0 — Restore state on reload:** In `loadMessages`, after messages are loaded, find the last assistant message containing `%%%ATOMIC_TRUTH_JSON_START%%%` and call `processAtomicTruth` on it. Also scan for quote results.

3. **P1 — OCR failure tracking:** In the OCR loop (lines 261-280), count failures and after the loop, if failures > 50% of pages, show `toast.warning()` and inject a system message.

4. **P1 — Use session token for auth:** Replace anon key in `streamAIResponse` and `runValidation`/`runPricing` headers with the user's access token from `supabase.auth.getSession()`.

5. **P1 — Stream timeout:** Wrap the fetch in `streamAIResponse` with an `AbortController` set to 5 minutes.

6. **P2 — Extend signed URL TTL:** Change `3600` to `7200` in `loadUploadedFiles`.

7. **P2 — Fix useCallback deps:** Add `projectId` to `streamAIResponse` dependency array.

