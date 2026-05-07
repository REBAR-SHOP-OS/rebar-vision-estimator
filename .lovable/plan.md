## Problem

The "Construction Buckets" panel on the Scope stage (`src/features/workflow-v2/stages/ScopeStage.tsx`) shows fake values that look like real estimates:

- **Line 266** — Header `Total Tonnage`: `(accepted.length * 14.2).toFixed(1)` — synthetic `14.2 TN per item`.
- **Line 294** — Each bucket row: `(2.5 + (i * 0.7)).toFixed(1)` — synthetic per-item TN.

Neither value is sourced from `estimate_items`, `verified_estimate_results`, or any real takeoff data. They are pure UI placeholders, which is exactly what the user is complaining about ("what is this guess?").

## Fix (minimum-patch)

Replace the two hardcoded math expressions with honest placeholders until real estimate data is wired in.

### Change 1 — Line 294 (per-item weight)
```tsx
<span className="text-muted-foreground">— TN</span>
```

### Change 2 — Line 266 (header total tonnage)
```tsx
<span>Total Tonnage <span className="text-foreground font-semibold ml-1">— TN</span></span>
```

That's it. Two lines, one file. No logic, no data fetching, no schema, no edge-function changes.

## Why not wire real numbers in the same patch?

Wiring real per-segment weights into this card requires:
- Querying `estimate_items` joined to `segments` and grouped by the bucket's segment-type mapping (5 buckets).
- Reconciling with `verified_estimate_results.result_json`.
- Handling the case where `auto-estimate` hasn't run or returned 0 weight.

That's a follow-up feature, not a bug fix. The user's complaint here is the **lie** (fake numbers shown as if real). Removing the lie is the smallest safe patch and matches the project's `MINIMAL CHANGE / PATCH-FIRST / PRODUCTION SAFE` rules.

## Files touched
- `src/features/workflow-v2/stages/ScopeStage.tsx` — 2 lines changed.

## Follow-up (separate request, not part of this patch)
When ready, add a `useEffect` in `ScopeStage` that loads `estimate_items` for the project, sums `total_weight` per bucket via `segment_type → bucket` map, and renders real kg/TN. Show `—` whenever the sum is 0 or the estimate hasn't run.