## Goal
Make the P12 "MISSING: HOST ELEMENT LENGTH" card go away without inventing new numbers, while keeping a clear audit trail that the value is an assumption (not a measured drawing dimension).

## Current state (verified in DB)
Row id `7de0ca57-2bc7-434c-aa7a-a1bc822a0722` (project `cd42ebfe…4593e3`):
- `description`: "2-15M TOP AND BOTTOM (Frost Slab Edge)"
- `quantity_count=33`, `total_length=330`, `total_weight=518.1`
- `assumptions_json.linear_geometry.lengthMm = null`  ← the actual blocker
- `assumptions_json.synthetic_estimate = true`, `assumed_slab_side_m = 10`
- `assumptions_json.missing_refs = ["host element length"]`

The QA card reads `missing_refs` and `linear_geometry.lengthMm`. As long as `lengthMm` is null and `missing_refs` contains "host element length", the card stays red.

## Fix (one-row data patch, no code change)

Update that single `estimate_items` row:

1. Set `assumptions_json.linear_geometry.lengthMm = 10000` (10 m, matching the synthetic basis already used for the weight).
2. Clear `assumptions_json.missing_refs` to `[]`.
3. Set `assumptions_json.geometry_status = "assumed_confirmed"` and add `confirmation_source = "user_accept_synthetic"` + `confirmed_at = now()` so the audit trail is honest.
4. Leave `quantity_count`, `total_length`, `total_weight` unchanged (they already match this assumption).
5. Keep `status = 'draft'` so it still shows up in review, but it will no longer carry the "missing host element length" blocker.
6. Insert one `audit_events` row: `entity_type='estimate_item'`, `action='accept_synthetic_host_length'`, `metadata={ item_id, prior_missing:["host element length"], assumed_length_mm:10000 }`.

## Why this and not "enter real dimensions"
- The drawing-derived host length isn't in the DB; OCR didn't pull it for that slab edge.
- Re-running OCR for the frost slab sheet is a much bigger job (re-extraction + segment relinking) and may still fail to find a clean dimension since it wasn't picked up the first time.
- Accepting the synthetic value with an explicit audit flag is the **smallest safe patch** that unblocks the workflow and preserves traceability — matches your Minimum Patch policy.

## What you'll see after
- The P12 card loses the red `MISSING: HOST ELEMENT LENGTH` chip.
- It shows as "Assumed (10 m frost slab edge)" so a reviewer can still spot it.
- Estimate totals don't change.

## If you'd rather not assume
Tell me the actual frost slab edge length from your drawings and I'll write that exact value in step 1 instead of 10000 mm — same patch, real number.

Approve and I'll apply it.