# Add Undo / Redo to the Takeoff Canvas toolbar

## Goal
Add **Undo** (↶) and **Redo** (↷) buttons to the left tool palette in `TakeoffCanvas.tsx` (the "layers" toolbar shown in the screenshot, above the page nav). They reverse and replay the user's last drawing/erase operations on overlay polygons.

## Scope
Single file: `src/components/takeoff-canvas/TakeoffCanvas.tsx`. No DB schema changes, no other components touched. Minimal patch.

## Behavior
Track per-session history of overlay edits (add / erase). Undo reverses the most recent op against the database; redo reapplies it.

- **Add op** (square/circle stamp, polygon close): undo deletes that polygon by id; redo re-inserts (new id) and updates the history entry's id.
- **Erase op**: undo re-inserts the previously-deleted polygon (new id); redo deletes it again.
- Any new user edit clears the redo stack (standard editor behavior).
- History is in-memory only (resets on remount / sheet change is fine — keep across page changes since polygons array is global).
- Buttons disabled when their stack is empty or when no `user`/`projectId`. Show toast on DB error and do not advance the stack.

## Keyboard shortcuts
- `Ctrl/Cmd + Z` → undo
- `Ctrl/Cmd + Shift + Z` (and `Ctrl/Cmd + Y`) → redo
- Skipped while typing in inputs (already the case — canvas has no inputs in scope).

## UI
Insert a new bordered group in the existing left tool palette (after the Erase button, before Zoom group):

```text
[ ↶ Undo ]   title="Undo (Ctrl+Z)"   disabled when undoStack empty
[ ↷ Redo ]   title="Redo (Ctrl+Shift+Z)"  disabled when redoStack empty
```

Use `Undo2` and `Redo2` from `lucide-react` (already a project dependency), styled with the existing `ToolBtn` component for visual consistency.

## Technical details

1. **State** (inside component):
   ```ts
   type HistoryOp =
     | { kind: "add"; id: string; snapshot: Omit<ManualPolygon,"id"> }
     | { kind: "erase"; snapshot: ManualPolygon };
   const [undoStack, setUndoStack] = useState<HistoryOp[]>([]);
   const [redoStack, setRedoStack] = useState<HistoryOp[]>([]);
   ```

2. **Record ops**:
   - In `saveOverlayPolygon` after successful insert, push `{kind:"add", id:data.id, snapshot:{segment_id,page_number,polygon,color_hint,source_file_id}}` and clear redo stack.
   - In `erasePolygon` after successful delete, push `{kind:"erase", snapshot: <the polygon row>}` and clear redo stack.

3. **Undo / redo helpers** that perform the inverse Supabase op against `takeoff_overlays`, mirror the same `setPolygons` mutation already used, then move the op between stacks (rewriting the `id` field on re-insert paths so subsequent redo/undo references the new row).

4. **Keyboard listener**: extend the existing `useEffect` shortcut handler at line 325 to also handle Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y.

5. **Imports**: extend the `lucide-react` import to add `Undo2, Redo2`.

## Risks
- DB latency: undo/redo is async; brief no-op feel until the round-trip completes. Acceptable — matches existing add/erase UX.
- If a polygon was modified outside this component since the op (concurrent session), redo of an erase will create a new row with a fresh id — accepted.

## Out of scope
- Persisting history across page reloads.
- Undoing the in-progress polygon `draft` (Esc already cancels it).
- Refactoring `TakeoffCanvas` structure.
