

## Audit Report: Obstacles & Issues Found in Rebar Shop OS

### Critical Issues

**1. SSE Parser Still Has a Break-on-Partial Bug (ChatArea.tsx:422-425)**
When a line does NOT start with `"data: "` and fails JSON parse, the code puts it back into `textBuffer` and `break`s out of the inner `while` loop. This is correct for partial lines, but the condition is inverted — a partial line that doesn't start with `"data: "` will be prepended back AND break, potentially stalling parsing if the next chunk starts mid-line. The `break` should only trigger for genuinely incomplete `data:` lines, not for random non-data lines (like SSE comments or empty lines that slipped through).

**Fix**: Remove the `else` branch break entirely. Non-data lines that fail parse should just be discarded. The existing guards on lines 378 (`startsWith(":")`, empty check, `!startsWith("data: ")`) already handle those cases before the try/catch.

**2. `processAtomicTruth` Sets `subStep("parsing")` AFTER Extraction (ChatArea.tsx:628)**
The sub-step progress shows "Parsing" only after JSON extraction succeeds (line 628), which is misleading. "Parsing" should display DURING the AI streaming phase, not after. The user sees no progress indicator during the longest phase.

**Fix**: Set `setSubStep("parsing")` at the START of `handleModeSelect` (line 687), clear it if streaming fails.

**3. `extractFallbackElements` Aggressive Regex Is Non-Greedy But Still Fragile (ChatArea.tsx:669)**
The regex `\{[\s\S]*?"elements"\s*:\s*\[[\s\S]*?\]\s*[\s\S]*?\}` uses lazy quantifiers which will match the SMALLEST possible JSON, often cutting off before the actual closing brace. For large element arrays this will produce invalid JSON and silently fail.

**Fix**: Use a bracket-counting approach or find `"elements"` then scan forward balancing `{`/`}`.

**4. Signed URL TTL Mismatch — Upload Uses 3600s, Streaming Uses 7200s (ChatArea.tsx:921 vs memory)**
File upload creates signed URLs with 3600s (1 hour) TTL, but the pipeline can take several minutes of pre-processing. If a user uploads, waits, then triggers analysis later, URLs may expire before the AI call.

**Fix**: Use 7200s consistently for all signed URLs in the upload path.

**5. DB Message Save Is Fire-and-Forget But Not Error-Handled (ChatArea.tsx:727-733)**
The assistant message DB insert has no `.then()` or `.catch()`. If it silently fails, message history is lost and `loadMessages` on revisit won't restore the estimation result. The user loses their work.

**Fix**: Add `.catch(err => console.error("Failed to save assistant message:", err))` at minimum.

**6. `sendMessage` Path Awaits DB Insert (ChatArea.tsx:840) — Inconsistent with handleModeSelect**
In `sendMessage` (line 840), the assistant message DB save is `await`ed, blocking the UI. In `handleModeSelect` (line 727), it's fire-and-forget. This inconsistency means follow-up messages feel slower than initial analysis.

**Fix**: Make `sendMessage` path also fire-and-forget for the assistant message save.

**7. Detection Endpoint Uses Anon Key Instead of User JWT (ChatArea.tsx:984)**
`DETECT_URL` fetch uses `VITE_SUPABASE_PUBLISHABLE_KEY` directly instead of the user's session token. This bypasses RLS and any auth-gated logic in the edge function.

**Fix**: Use `sess?.session?.access_token` like the other edge function calls.

**8. OCR Pages Are Sequential — 10 Pages × ~3s Each = 30s Blocking (ChatArea.tsx:271-292)**
Each OCR page is processed one at a time in a `for` loop. With 10 pages at ~3-4 seconds each, this blocks the UI for 30-40 seconds.

**Fix**: Batch OCR calls in groups of 3-4 using `Promise.all` for parallelism.

**9. `MASTER_PROMPT` Line 642 Contradicts `OUTPUT_FORMAT_INSTRUCTIONS` Line 648**
Line 642: `"OUTPUT: You must return STRICT JSON ONLY that meets the schema. No prose outside JSON."`
Line 648: `"Your response MUST have TWO sections... JSON BLOCK FIRST, then the human-readable analysis."`
These are contradictory — one says JSON only, the other says JSON + prose. The AI model may follow either instruction randomly.

**Fix**: Remove line 642 or reword to: `"OUTPUT: You must return the structured JSON wrapped in markers, followed by human-readable analysis."`

### Medium Issues

**10. No Retry Logic on AI Streaming Failure**
If the AI gateway returns 500 or the stream drops, there's no retry. The user must manually click again.

**11. `loadMessages` Restores Validation But Not Quote Result**
On page reload, `loadMessages` (line 142-149) restores `validationData` from the last assistant message, but `quoteResult` is never restored. The Bar List tab disappears on refresh.

**12. `renderPdfPagesToImages` Has No Cleanup on Error**
If the upload fails mid-way through 10 pages, already-uploaded images remain in storage as orphans.

**13. Memory Leak Risk: Canvas Objects in `renderPdfPagesToImages`**
Canvas width/height are set to 0 for cleanup (pdf-to-images.ts:71-72), but the canvas element itself isn't removed from DOM if accidentally appended.

### Low Priority

**14. `estimationGroupFilter` state not persisted** — resets on component remount.
**15. `viewerOpenCounter` ref is incremented but never read** — dead code.
**16. File input accepts `*` (line 1598) — should restrict to supported formats.

---

### Recommended Implementation Order

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| P0 | #9 — Contradictory prompt instructions | Root cause of extraction failures | Small |
| P0 | #5 — DB save error handling | Data loss | Tiny |
| P1 | #8 — Parallel OCR | 30s → 10s perceived speed | Small |
| P1 | #2 — Sub-step progress timing | UX clarity | Tiny |
| P1 | #7 — Detection auth token | Security | Tiny |
| P1 | #4 — Signed URL TTL | Expiry failures | Tiny |
| P1 | #6 — Consistent fire-and-forget saves | UX speed | Tiny |
| P2 | #1 — SSE parser break logic | Edge case stream stall | Small |
| P2 | #3 — Fallback regex robustness | Missed extractions | Medium |
| P2 | #11 — Restore quoteResult on reload | UX continuity | Medium |

All fixes are minimal diffs (1-10 lines each). No new files. No schema changes.

