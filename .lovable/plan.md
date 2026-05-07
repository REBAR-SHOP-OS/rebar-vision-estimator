# Fix: Save Answer & Mark Resolved appear inactive

## Root cause

The buttons *are* wired and the click reaches the database (the brick‑ledge issue in the screenshot is already `status='answered'` in `validation_issues`). Two things make them feel "not active":

1. **`persistIssueStatus` silently downgrades `resolved` → `answered`**
   In `src/features/workflow-v2/stages/QAStage.tsx` (lines 469‑474), if `applyEngineerAnswerToEstimateItem` reports `geometryStatus !== "resolved"`, the requested status is rewritten to `"answered"`. Because only `"resolved"` / `"closed"` are in `CLOSED_QA_STATUSES`, the issue is **not removed from the list** and the side panel re‑renders with the same content. The engineer clicks "Mark Resolved" and visually nothing happens → "button not active".

2. **`applyEngineerAnswerToEstimateItem` only treats geometry as resolved when *quantity, length AND weight* are all parsed numerically** (`assistant-logic.ts` line 649). Free‑text answers like *"115 mm typical; 152 mm where wall > 300 mm"* never produce all three numbers, so geometry stays `partial` and the downgrade above kicks in every time.

The result: Mark Resolved is effectively unreachable from any text-only engineer answer, and Save Answer looks like a no‑op because the same row stays selected.

## Fix (minimum patch, two files)

### 1. `src/features/workflow-v2/stages/QAStage.tsx` — respect explicit user intent

Inside `persistIssueStatus`:

- Remove the silent downgrade. When the engineer clicks **Mark Resolved**, persist `status="resolved"` and let `updateSelectedIssue` advance to the next issue.
- Keep the takeoff‑geometry warning, but surface it as an **appended note** on the saved record only — do **not** rewrite the status.
- After a successful Save Answer (`status="answered"`), give visible feedback by:
  - clearing `answerError`,
  - setting a transient `answerSavedAt` flag (already have `answerSaving`) so the button label briefly reads "Saved ✓" for ~1.2 s.

### 2. `src/features/workflow-v2/stages/assistant-logic.ts` — broaden "resolved" criteria

In `applyEngineerAnswerToEstimateItem` (lines 642‑653):

- If the caller passes `requestedStatus === "resolved"`, treat it as resolved when **either** all numeric values parse **or** the engineer supplied any structured value / non‑empty answer text. This matches the human contract: "engineer reviewed and signed off".
- Continue to compute `geometryStatus = "partial"` when only some numbers are present, but no longer block the issue‑level status from going to `resolved`.

### Optional polish (same QAStage file, ~3 lines)

- Make the secondary buttons (`Mark Resolved`, `Needs Review`) use `bg-secondary text-secondary-foreground` instead of `bg-card`, so they read as actionable instead of dimmed against the dark panel (the user’s screenshot shows them looking grayed out).

## Out of scope

- No DB schema changes.
- No changes to `auto-estimate` / `extract-dimensions` edge functions.
- No changes to the takeoff geometry parser; we only stop it from overriding the engineer’s explicit decision.

## Verification

1. Open a QA issue with a free‑text answer (e.g. brick ledge on P17).
2. Click **Save Answer** → button shows "Saved ✓" briefly, issue stays selected, `validation_issues.status='answered'`, panel shows "Saved: …".
3. Click **Mark Resolved** → issue is removed from the list, selection moves to the next open issue, `validation_issues.status='resolved'`.
4. Click **Needs Review** → issue stays in the list with `status='review'` badge.
