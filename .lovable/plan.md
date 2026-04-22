

# Unblock exports: commit reviewed lines

## Current state

The `verified_estimate_results` table is fixed and the canonical snapshot is being persisted. The export gate is now correctly returning:

> Blocked: all lines are marked `review_required` — nothing committed for export.

This means the pipeline is working — but every line in `estimate_items` / `bar_items` is flagged `review_required = true`, so no line is "committed" for export.

## Options to unblock

### Option A — Add a "Commit reviewed lines" action (recommended)
Add a button on the **Outputs** tab (next to "Refresh canonical estimate") that:
1. Lets the user mark all current estimate lines as reviewed in one click (or per-segment), OR
2. Opens the **QA / Issues** tab where lines can be reviewed individually

This is the trust-first approach: nothing exports until a human commits.

### Option B — Per-line review in Segments tab
Add a checkbox column on the segment detail view to toggle `review_required` per line, with a "Mark all reviewed" bulk action.

### Option C — Lower the gate temporarily (NOT recommended)
Add a "Force export (draft mode)" toggle that bypasses the `review_required` filter. Marks the export with a `DRAFT — UNREVIEWED` watermark. Useful for internal previews only.

## Recommended plan: Option A

### 1. Add `commitReviewedLines` helper
**File**: `src/lib/verified-estimate/verified-estimate-store.ts` (~15 lines added)
- New function: `commitAllLines(supabase, projectId, userId)` 
- Updates a `review_required` flag on `estimate_items` and `bar_items` to `false` for the project
- Then re-runs `refreshVerifiedEstimateFromWorkspace` to regenerate the snapshot

### 2. Add UI button on OutputsTab
**File**: `src/components/workspace/OutputsTab.tsx` (~20 lines added)
- New button: **"Commit all lines for export"** next to "Refresh canonical estimate"
- Shows confirmation dialog: "This will mark all 25 estimate lines as reviewed and ready for export. Continue?"
- On confirm → calls `commitAllLines` → toast success → refresh card states
- Disabled if all lines already committed

### 3. Migration: ensure `review_required` column exists
**File**: new migration
- `estimate_items` and `bar_items` don't currently have a `review_required` column — the gate reads it from the canonical snapshot built by `build-canonical-result.ts`
- Need to check whether `review_required` is derived from confidence/validation_status or stored on the row
- If derived: fix is a one-line change in `build-canonical-result.ts` to flip the default
- If stored: add `review_required boolean default true` column + migration

## Technical details

- The `review_required` flag on `CanonicalEstimateLine` is set inside `build-canonical-result.ts` — need to inspect how it's currently determined to know whether the fix is in code (derivation logic) or DB (a new column + audit trail)
- All other gate checks (confidence, source linkage, validation issues) appear to pass — only `review_required` is blocking
- Audit logging via `logAuditEvent("lines_committed_for_export", ...)` to track who approved

## Files touched

- `src/lib/verified-estimate/build-canonical-result.ts` — inspect & possibly adjust `review_required` derivation
- `src/lib/verified-estimate/verified-estimate-store.ts` — add commit helper (~15 lines)
- `src/components/workspace/OutputsTab.tsx` — add commit button + confirm dialog (~20 lines)
- Possibly one new migration if `review_required` needs to be a stored column

## Out of scope

- Per-line granular review UI (Option B) — defer to future task
- Force-export bypass (Option C) — rejected as it weakens trust-first model

