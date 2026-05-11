## Problem

On project `51e9c8bc…` the left pane shows **"No candidates detected — OCR did not surface a usable scope"**, but the top bar shows **SCOPE APPROVED 16/16** and **TAKEOFF ROWS 7**. The scope is already approved on the server; the empty state is misleading and blocks the user from selecting a candidate to drive the right-pane SELECTION overlay we just added.

## Root cause

1. `auto-segments` filters out any suggestion whose name matches `existingSegNames` (segments already saved on the project). With 16 approved items already materialised as segments, every must-have and AI suggestion gets stripped → response is `{ suggestions: [] }`.
2. `ScopeStage.runDetection` treats `suggestions.length === 0` as a **detection failure** and flips `detectFailed = true`, even though the server-side `projects.scope_items` array contains 16 valid approved labels (exposed as `state.approvedScopeItems`).
3. The left list (`candidates`) is built only from `state.local.scopeCandidates`, never from `state.approvedScopeItems`, so already-approved scope is invisible until OCR re-detects it.

## Fix (frontend only, minimum patch)

Edit only `src/features/workflow-v2/stages/ScopeStage.tsx`. No edge-function or DB changes.

1. **Seed candidates from `state.approvedScopeItems`** when the local cache is empty:
   - In the `candidates` `useMemo`, if `cached.length === 0` and `state.approvedScopeItems.length > 0`, synthesize `Candidate[]` from the approved labels with `source = "approved scope"`, `confidence = 1`, `id = "approved-<label>"`. This is purely cosmetic — they already carry `getDecision === "accept"` via `serverApprovedLabels`.

2. **Don't flag detection as failed when scope already exists**:
   - In `runDetection`, when `suggestions.length === 0`, only set `detectFailed = true` if `state.approvedScopeItems.length === 0`. Otherwise leave it false (the list will render the approved items from step 1).

3. **Refine the empty-state copy**:
   - When `candidates.length === 0` and `state.approvedScopeItems.length > 0` (shouldn't happen after step 1, defensive only), show "Scope already approved" instead of the OCR failure message.
   - Keep the existing "No candidates detected" + Retry button only for the true OCR-empty case.

4. **Keep the SELECTION overlay working**: with approved items now in `candidates`, `selectedId` will resolve to the first approved label, `selectedPage` lookup against `searchPages` keeps working unchanged, and the right-pane orange highlight will appear without further wiring.

## Out of scope

- `supabase/functions/auto-segments/index.ts` — no change. (Echoing already-approved items back from the server would be a larger refactor and risks duplicating approved segments.)
- `TakeoffCanvas`, `CalibrationStage`, `TakeoffStage`, `PdfRenderer` — untouched.
- No DB migration, no RLS change, no new state in `useWorkflowState`.

## Verification

- Reload the affected project → left pane shows 16 approved candidates with the "Approved" pill, top bar still reads **0 NEW**.
- Click any candidate → right pane jumps to the matching page and renders the pulsing orange `SELECTION: <label>` overlay.
- For a fresh project with no approved scope and OCR that returns nothing, the existing "No candidates detected" + Retry block still appears.
- `bunx tsc --noEmit` passes.
