# Phase 1.5 — Close the 3 Open Dimension Gaps + Phantom Segment Cleanup

Before shipping the Phase 1 gate, fill the remaining unknowns so CRU-1 isn't immediately blocked when the gate goes live.

## A. Vision pass on elevations (S-2.0 / S-2.1)

Goal: extract **foundation wall height** (and pick up strip footing width × thickness if shown in section details on the same sheets / S-6.x).

- Fetch signed URLs for the 3 relevant page images already in storage:
  - S-2.0 (foundation wall elevation)
  - S-2.1 (foundation wall elevation continued)
  - S-6.x typical wall-on-strip-footing section (the detail that shows W × T of the strip)
- Single Gemini 2.5 Pro Vision call (max 3 images per call per memory rule) with a tight prompt:
  - "Read dimensions only. For each wall elevation: report wall height (top of wall to top of footing) in mm with source citation. For the section detail: report strip footing width and thickness in mm with source citation. Output JSON, no prose. Mark any value not directly dimensioned as `null`."
- Temp = 0, deterministic config.
- Write nothing to DB yet — return results in chat for confirmation, same pattern as Phase 0.

Expected output (one row per item, citations included):
```
WF-1 height       : ____ mm   [S-2.0 elev mark __]
Strip footing W   : ____ mm   [S-6.x detail __]
Strip footing T   : ____ mm   [S-6.x detail __]
```

## B. Resolve "Shear Walls" segment

Comprehensive OCR sweep already found **no element labeled "Shear Wall"** in CRU-1. Three candidate resolutions to present:

1. **Delete** — segment is phantom (auto-segments inferred it from project-type heuristics, no drawing basis). Recommended unless the user knows otherwise.
2. **Rename + remap** — the closest physical match is the 12″ interior concrete wall around the Garbage Enclosure (T.D.17, page 11). Rename "Shear Walls" → "Interior Concrete Walls" and point it at that detail.
3. **Keep + mark `na`** — leave the segment but set `dimensions_status = 'na'` so the Phase 1 gate ignores it.

We do NOT delete or rename anything in this turn — we surface the choice and execute on the user's call.

## C. After A + B → run Phase 1 (already-approved plan)

Once the 3 gaps are filled and the Shear Walls decision is made, immediately execute the previously-approved Phase 1:

1. Migration: add `dimensions_status`, `dimensions_locked_at`, `dimensions_locked_by` to `segments`.
2. New `extract-dimensions` edge function (thin router).
3. Insert ~12-line gate in `auto-estimate` returning 422 `DIMENSIONS_INCOMPLETE`.
4. Backfill: any segment with existing `assumptions_json.geometry` → `complete`. CRU-1's Footings/Walls (and Shear Walls if kept) → `complete` from the dims we'll have just confirmed.
5. Insert `agent_knowledge` rule "Dimensions-First Discipline".

## Files touched in this loop

| File | Change |
|---|---|
| (no code) Vision script | One-off Gemini Vision call, results posted in chat |
| Migration (new) | 3 columns on `segments` |
| `supabase/functions/extract-dimensions/index.ts` (new) | Dims edge function |
| `supabase/functions/auto-estimate/index.ts` | +12-line gate |
| `agent_knowledge` (insert) | 1 rule row |
| `segments` (data update) | Backfill statuses + Shear Walls resolution |

## Out of scope

- Phase 2 Dimensions tab UI (next loop)
- OCR/Vision pipeline rewrite, cage rules, shop drawings, auth/storage/reserved schemas

## Acceptance

1. Chat shows confirmed wall height + strip footing W × T with sheet citations.
2. Shear Walls decision recorded (deleted / renamed / `na`).
3. `auto-estimate` on CRU-1 returns 200 (not 422) because every segment is `complete` or `na`.
4. New segment with no dims → `auto-estimate` returns 422 with blocker list.

Approve to execute A + B + C in one default-mode pass.
