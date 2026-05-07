## Scope correction

The earlier "65 errors / 116 segments" count was across **all 18 of your projects**. Re-scoped to **CRU-1 only** (`a24bba42…`):

- **9 segments** — 6 empty placeholders (no estimate items, no bar items, no issues), 3 active.
- **11 open issues — all `warning`, 0 errors.** Not blocking finalization per gating rules; just noisy.
- The 11 warnings are 4 distinct issues (housekeeping pad on p15, brick ledge on p16) duplicated across the 3 active segments (Footings, Shear Walls, Walls).

## Plan (CRU-1 only, surgical)

### 1. Delete 6 empty placeholder segments
No estimate_items, no bar_items, no validation_issues attached — safe to remove. Frees the Segments dashboard from clutter.

| ID | Name | Type |
|---|---|---|
| ad0a8625… | Columns (per level) | column |
| 00f9c7f5… | Elevated Slabs | slab |
| c9f0b42b… | Elevated Slabs (per level) | slab |
| f4614abd… | L1 Columns | column |
| 049d1bc9… | Pile Caps / Pad Footings | footing |
| 47a35a4e… | SOG Slab-on-Grade | slab |

### 2. Defer the 11 open warnings
Set `status='deferred'` with note: *"Brick-ledge / housekeeping-pad geometry on arch sheets p15-p16; resolve via structural sheet upload or manual dim entry. Warning-level only — not blocking finalization."* Preserves audit trail; surfaces under a "Deferred" filter; unblocks the Outputs/Quote step.

### 3. Leave the 3 active segments untouched
Footings, Shear Walls, Walls keep all their estimate_items and bar_items. After cleanup, CRU-1 = 3 segments, 0 open issues, ready for `Generate Estimate Version`.

## Out of scope (call out, don't execute)

- The other 17 projects with 65 errors total — not touching unless you ask.
- Segment-merge across projects — not needed since CRU-1 has no within-project dupes.
- Re-running `auto-segments` / `analyze-blueprint` — defer until after you confirm cleanup looks right in the UI.

## Approve to proceed
On approval I'll run two SQL ops (1 DELETE, 1 UPDATE) via the insert tool, both filtered by `user_id` + `project_id='a24bba42…'`. No code changes, no edge function deploys.