# Fix Dimension Problem — Project + Going Forward

## Goal
Stop inventing `10 m × 3 m` placeholder dimensions. Extract real dimensions from drawings using OCR + Vision, persist them in `agent_knowledge` per project, and gate `auto-estimate` until dimensions are real.

---

## Part A — Repair current project (`cd42ebfe…` LONDON_CRU1-7)

1. **Revert synthetic patches** (data migration via insert tool):
   - For the 14 estimate items touched by `accept_synthetic_dims_bulk`:
     - Remove `linear_geometry.lengthMm = 10000` and `heightMm = 3000` defaults where `confirmation_source = "user_accept_synthetic_bulk"` or `"user_accept_synthetic"`.
     - Restore `missing_refs` from `audit_events.metadata.previous_missing_refs`.
     - Set `geometry_status = "partial"`, clear `confirmed_at`, clear `confirmation_source`.
   - Flip the 8 segments back to `dimensions_status = 'pending'`.
   - Log one `audit_events` row per item: `revert_synthetic_host_length`.

2. **Run `extract-dimensions` edge function** on this project:
   - OCR sweep all sheets for scale + schedule dimensions.
   - **Vision pass** on plan/elevation/section sheets for host lengths + heights OCR can't see (P9, P11, P13, P16, frost slab, brick ledge, shear walls, housekeeping pads).
   - Persist a single `agent_knowledge` row keyed by project (type=`project_dimensions`, file_path=`projects/{id}/dimensions.json`) — same shape as the existing CRU-1 row.

3. **Re-run `auto-estimate`** — items resolve from real `agent_knowledge` dimensions. Genuine gaps remain as `MISSING:` chips for human review (no synthetic fill).

---

## Part B — Going forward (all projects)

4. **Pipeline gate** (`auto-estimate` edge function):
   - Before estimating, require either:
     - `agent_knowledge` row of type `project_dimensions` for `project_id`, OR
     - All `segments.dimensions_status IN ('complete','na')`.
   - If neither, auto-invoke `extract-dimensions` first. Never fall through to `10000 mm` defaults.

5. **Remove synthetic-default code paths**:
   - In `auto-estimate` and any synthetic-quote helper, delete the `lengthMm ?? 10000` / `heightMm ?? 3000` fallbacks. On missing dim, emit `MISSING:` and skip that item, do not synthesize.

6. **`extract-dimensions` improvements**:
   - Always run Vision on plan + elevation + section sheets (not just OCR).
   - Write dimensions to `agent_knowledge` (project-scoped) at end of every run, so estimator loads them on every prompt going forward.
   - Add audit log entry `dimensions_extracted` with source breakdown (OCR vs Vision per dimension).

7. **Backfill sweep** (one-shot script via edge function):
   - For every project with synthetic-marked items (`assumptions_json->>'confirmation_source' LIKE 'user_accept_synthetic%'`):
     - Apply Part A steps 1–3.
   - Idempotent — safe to re-run.

---

## Technical Notes

- All schema unchanged. Only data + edge function logic.
- Migration tool used only for any new index / no DDL needed here — data ops via insert tool.
- Edge functions touched: `auto-estimate`, `extract-dimensions`, new `backfill-dimensions` (one-shot).
- Respects FAIL-CLOSED rule: missing dim → `MISSING:` chip, never invented value.
- Respects Trust-First / Never-invent-values core rules.

## Out of scope
- No UI changes. QA cards already render `MISSING:` chips correctly once data is honest.
