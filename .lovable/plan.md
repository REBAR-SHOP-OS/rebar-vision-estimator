# Fix Scale Calibration page flicker

## Root cause

In `src/features/workflow-v2/WorkflowShell.tsx`, the active stage is rendered through a **component declared inside the parent render function**:

```tsx
const StageBody = () => {
  const props = { projectId, state, goToStage: ... };
  switch (active) {
    case "calibration": return <CalibrationStage {...props} />;
    ...
  }
};
...
<StageBody />
```

Because `StageBody` is a brand-new function reference on every render of `WorkflowShell`, React treats it as a different component type each time and **unmounts + remounts `CalibrationStage` on every parent re-render**.

`WorkflowShell` re-renders frequently (KPI memo, `setStageStatus` effect, `useWorkflowState` returning a new object each tick). Every remount of `CalibrationStage`:

1. Resets `sheets`, `steps`, `emptyState` to initial values → UI shows the "Loading sheets…" / spinner overlay.
2. Re-fires the `useEffect(load, [projectId, showAll])` → re-queries `drawing_search_index`, `sheet_revisions`, `logical_drawings`, `document_versions`.
3. When the queries resolve, sheets render, then the next parent render remounts again → visible flicker.

This matches the screenshot (steps still spinning, "Loading sheets…" overlay) and the repeated reloads that look like flicker.

## Fix (minimum patch)

Edit only `src/features/workflow-v2/WorkflowShell.tsx`:

1. Delete the inline `StageBody` component.
2. Inline the `switch (active)` directly inside the JSX where `<StageBody />` is rendered, returning the chosen stage element. This keeps the same `CalibrationStage` instance mounted across re-renders, so its `sheets` / `steps` state survives and `load()` only runs when `projectId` or `showAll` actually change.

No changes to `CalibrationStage.tsx`, `useWorkflowState.ts`, data fetching, styling, or behavior. Other stages benefit identically (Takeoff, QA, etc. were also remounting).

## Verification

- Reload `/app/project/.../` → Stage 03 should mount once, run the 4 loading steps once, then render the sheet list with no spinner blink.
- Switching tabs (Files ↔ Scope ↔ Calibration) still works because the inline `switch` selects a different element when `active` changes (intended remount).
- Existing Vitest suite (`calibration-stage-state`, `scale-resolver`, `two-point-calibration`) is unaffected.
