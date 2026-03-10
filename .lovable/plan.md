
Goal: stop the false warning `⚠️ Estimation completed but structured output was not returned...` from appearing during normal follow-up actions (including export-related interactions).

What I found
- The warning is generated only in `src/components/chat/ChatArea.tsx` inside `handlePostStream` when `processAtomicTruth(fullContent)` fails.
- `handlePostStream` runs for every streamed AI reply once a mode is selected (not only full estimation runs).
- Current suppression uses `isConversational` heuristics (length/keywords), which can still fail on long non-estimation replies and trigger the warning incorrectly.

Implementation plan
1. Add explicit “expect structured output” control
- Introduce a boolean parameter to `handlePostStream`, e.g. `expectStructuredOutput`.
- Only show the warning when:
  - `expectStructuredOutput === true`
  - atomic JSON extraction failed
  - response is not an intentional block case.

2. Add a dedicated intent helper for chat follow-ups
- Add helper in `ChatArea.tsx` such as `shouldExpectStructuredOutput(message: string, hasExistingQuote: boolean)`.
- Rules:
  - Return `true` for estimation intents (`start`, `analyze`, `estimate`, `recalculate`, `rerun`, `proceed`).
  - Return `false` for informational/chat intents (`show`, `explain`, `review`, `what`, `why`, etc.).
  - If a quote already exists, default to `false` unless explicit re-estimation intent is detected.

3. Update both call sites
- `handleModeSelect(...)` (initial run): always pass `expectStructuredOutput: true`.
- `sendMessage(...)` continuation path: compute from user message using the new helper and pass that value to `handlePostStream`.

4. Keep intentional blocked behavior unchanged
- Preserve existing `isIntentionalBlock` handling so legitimate “cannot estimate due to missing drawings” outputs do not get mislabeled.

5. Light observability for future debugging
- Add concise debug logs around warning decision path (`expectStructuredOutput`, `extracted`, `intent detected`) so future false positives can be diagnosed quickly without changing UX.

Technical details
- File: `src/components/chat/ChatArea.tsx` only.
- No backend/schema changes.
- This is a logic hardening fix (state + intent-based gating), replacing brittle content-size heuristics as the primary gate.
- Expected outcome: exports and normal follow-up chat no longer surface the structured-output warning unless the user explicitly requested a full estimation output.
