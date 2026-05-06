# Fix: Data doesn't flow from Stage 2 → Stage 3

## Root cause

Stage 3 (`TakeoffStage`) only **reads** existing `estimate_items` and canonical `rebar.takeoff_items` for the project. For project `6d0fcbf5…`:

- `project_files`: 2
- `scope_items` on `projects`: NULL
- `segments`: 0
- `estimate_items`: 0

Stage 2 (`ScopeStage`) currently only:
1. Updates the local `scope` map in localStorage.
2. Appends the candidate label to `projects.scope_items`.
3. Sets `workflow_status = 'scope_detected'`.

It **never creates `segments`** and **never invokes `auto-estimate`** (or any takeoff producer). Because of that, Stage 3 always finds zero rows even after the user approves scope items.

The `auto-estimate` edge function exists and writes to `estimate_items`, but it requires a `segment_id` — which the V2 workflow never creates.

## Fix (minimum patch)

Two small, surgical changes — no rewrites, no UI redesign:

### 1. `ScopeStage.tsx` — create a segment when a candidate is approved

In the existing `setDecision(id, "accept")` branch (the same block that writes `scope_items`), also upsert a `segments` row:

- `project_id = projectId`
- `user_id = auth.uid()`
- `name = candidate.label`
- `segment_type = 'miscellaneous'` (default)
- `status = 'draft'`
- Idempotent: skip insert if a segment with the same `(project_id, name)` already exists.

On reject (`hold` / `reroute`), do **not** delete the segment (preserves any downstream work). Existing `scope_items` array logic is unchanged.

### 2. `TakeoffStage.tsx` — add a "Generate Takeoff" action when no rows exist

Currently the empty state just says *"Accept scope candidates and run extraction to populate."* Replace the hint with a button that:

1. Fetches `segments` for this project that have no `estimate_items` yet.
2. For each, calls `supabase.functions.invoke("auto-estimate", { body: { segment_id, project_id }})` sequentially (small N, typically ≤ 7).
3. Shows a toast with progress and on success calls `state.refresh()` + reloads rows.

No schema changes. No new edge functions. Reuses the existing `auto-estimate` function that already writes `estimate_items` rows that `loadLegacyTakeoffRows` consumes.

## Files touched

- `src/features/workflow-v2/stages/ScopeStage.tsx` — add segment upsert inside existing `setDecision` accept branch (~15 lines).
- `src/features/workflow-v2/stages/TakeoffStage.tsx` — add "Generate Takeoff" button + handler in the existing empty-state slot (~30 lines).

## Out of scope

- No redesign of layout, no new tables, no canonical `rebar.takeoff_runs` writes (those continue to come from the existing canonical pipeline if/when it runs).
- No changes to `auto-estimate` itself.
- No deletion of segments on reject (safer default).
