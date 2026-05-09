# Stage 03 Scale Calibration — Loading & Stuck-State Fix

## Problem

Users report Stage 03 (Scale Calibration) feels "stuck". Audit of `src/features/workflow-v2/stages/CalibrationStage.tsx`:

- `confirmAll()` is fully synchronous (`setLocal` + `refresh` + `goToStage("takeoff")`) — navigation actually fires immediately, but there is **no visual feedback** between click and the next stage rendering, so the UI looks frozen for a beat.
- `load()` runs four sequential Supabase queries (drawing_search_index, sheet_revisions, logical_drawings, document_versions). On large projects this can take several seconds. During that time the **only** indicator is a small "Loading sheets…" empty-state in the body — the **Re-detect** and **Confirm** buttons in the header give no spinner and stay clickable, so repeat clicks queue up duplicate loads.
- If `load()` throws (network blip, RLS error, table miss), `setLoading(false)` is never reached → permanent "Loading sheets…" with no error → user perceives the stage as bricked. There is no try/catch and no toast.
- `confirmAll()` does not check `allConfirmable` itself (it relies on `disabled`), and does not guard against double-click during the brief navigation window.

## Fix (minimum patch, single file)

Edit only `src/features/workflow-v2/stages/CalibrationStage.tsx`:

1. **Wrap `load()` in try/catch/finally** — guarantees `setLoading(false)` runs even on error. Surface failure with `toast.error("Failed to load sheets — retry")` (already importing `sonner` patterns elsewhere).
2. **Add a `confirming` boolean state**. `confirmAll()` becomes:
   - set `confirming = true`
   - run `setLocal` + `refresh`
   - `requestAnimationFrame(() => goToStage?.("takeoff"))` so React paints the disabled/loading state before unmount
   - reset `confirming` in a `finally`-style guard (mostly cosmetic since the component unmounts).
3. **Header buttons reflect in-flight state**:
   - Re-detect button: show `<Loader2 className="animate-spin" />` and `disabled` while `loading === true`.
   - Confirm button: show spinner + "Confirming…" label while `confirming === true`, and `disabled` whenever `loading || confirming || !allConfirmable`.
4. **Body loading state**: replace the bare `EmptyState title="Loading sheets…"` with the same EmptyState plus a centered `<Loader2 className="animate-spin" />` so the user sees motion (not just static text). No new component — reuse the spinner icon already imported elsewhere via `lucide-react`.
5. **Prevent duplicate `load()` calls** by early-returning if `loading === true` at the top of the function.

## Out of scope

- No changes to `scale-resolver.ts`, `WorkflowShell.tsx`, `useWorkflowState.ts`, `TakeoffStage.tsx`, or any edge function.
- No DB schema or RLS changes.
- No redesign of the calibration flow — only loading-state hardening.
- The existing gating logic (low-confidence auto values count as resolved, Confirm enabled when `allConfirmable`) is preserved exactly.

## Risk

Very low. All changes are additive UI guards in one file. Worst case: a spinner shows for an extra frame. Existing tests (`stage-2-to-3-navigation.test.ts`) only assert gate logic, which is unchanged.
