## Estimator audit — what's already strong

After the last 5 patches the estimator already has:
- Project-spec precedence for lap / cover / grade (with `lap_source`, `cover_source`, `grade_source` columns).
- Deterministic-match gating + 0.6 confidence ceiling for AI-only rows.
- MAD outlier guard on length-per-piece (3.5σ, samples ≥4) → flagged rows become `unresolved` with an `error` validation issue.
- Tiered waste factors (small 3% / large 5% / stirrup 8%) sourced from `standards_profiles.waste_factors`.
- Per-row source provenance, citation-missing detection, weight-gate per segment type.

## Remaining accuracy gaps (root-cause review)

| # | Gap | Impact on 99.9% target |
|---|---|---|
| 1 | `REBAR_MASS_KG_PER_M` table only covers #3–#8 / 10M–35M. A `#9 / #10 / #11 / 45M / 55M` callout silently weighs **0 kg** (massFor returns 0). | Missing-item / weight error on heavier-bar projects. |
| 2 | When AI returns a `total_weight`, it is trusted (`Number(it.total_weight) > 0 ? it.total_weight : aiLen*mass`). AI hallucinations propagate into final totals. | Direct weight error. |
| 3 | WWM rows: `massFor` returns kg/**m²**, but it's multiplied by `total_length` (linear m) → wrong units. WWM weight is mass × area, not mass × length. | 100%+ error on any segment with mesh. |
| 4 | Size→tier classifier uses `Math.round(metric/3.18)` for waste tiering — 25M maps to #8, 30M to #9, 35M to #11. Crude but works for waste; **but the same mass table has no entries for #9–#11**, compounding gap #1. | Silent zero-weight on metric ≥30M with imperial-keyed lookup paths. |
| 5 | No round-trip integrity check: deterministic resolver computes `total_weight = total_length × mass`, but if the AI's `total_length` was wrong, nothing flags that the segment total deviates from sum-of-bar-items (`auto-bar-schedule` output for the same segment). | Cross-engine drift goes undetected. |
| 6 | Stock-length splice math: bars ship in 20/40/60 ft (or 6/12/18 m) lengths. When `bar_len > stock`, the resolver currently produces 1 piece — real shop adds `ceil(bar_len/stock)−1` lap splices × lap-length per splice. Missing tonnage ≈ 1–3%. | Systematic under-estimation on tall walls / long footings. |
| 7 | Hook / bend additions absent in the deterministic path (only the AI is told to "leave hooks alone"). RSIC standard hooks add real cm to cut length. | Small but recurring under-call. |

## Patches (minimum-diff, all in `supabase/functions/auto-estimate/index.ts` unless noted)

### Patch A — Complete mass tables (gap #1, #4)
Extend `REBAR_MASS_KG_PER_M` with the rest of the RSIC weight table:
```
"#9":5.060, "#10":6.404, "#11":7.907, "#14":11.384, "#18":20.238,
"45M":11.775, "55M":19.625
```
Update `sizeKey()` regex to include `#9|#10|#11|#14|#18|45M|55M`.

### Patch B — Always recompute weight deterministically (gap #2)
In `resolveItem` / `resolveLinear` / `resolveWall`, replace:
```ts
totalWeightKg: Number(it.total_weight) > 0 ? Number(it.total_weight) : +(aiLen*mass).toFixed(2)
```
with:
```ts
totalWeightKg: mass > 0 ? +(totalLengthM * mass).toFixed(2) : 0
```
Track AI's value in `assumptions_json.ai_reported_weight_kg` for audit; never trust it as truth.

### Patch C — Correct WWM units (gap #3)
Add `item_type === "wwm"` branch: weight = mass(kg/m²) × `area_m2` (extracted from description like `"6X6-W2.9 - 250m²"`). When area is missing → `geometry_status='unresolved'`, weight=0, queue validation issue "WWM area not extracted". Stop multiplying kg/m² by linear meters.

### Patch D — Cross-engine reconciliation gate (gap #5)
After `dedupedRows` is built (around line 1779), query `bar_items` for the same `segment_id`, sum their `cut_length × quantity × mass(size)` to a "bar-schedule weight". Compare to estimator's `Σ total_weight`:
- delta < 5% → no-op.
- 5–15% → `validation_issues` severity `warning`, type `cross_engine_drift`.
- > 15% → severity `error`, blocks approval (matches existing `<15% OK / 15–35% FLAG / >35% RISK_ALERT` thresholds in mem://logic/reconciliation-thresholds).
Records both totals in the issue `source_refs`.

### Patch E — Stock-length splice augmentation (gap #6)
New helper `applySpliceWaste(barLenM, sizeKey, lapMm, stockM=18)`:
```ts
if (barLenM <= stockM) return barLenM;
const splices = Math.ceil(barLenM/stockM) - 1;
return barLenM + splices * (lapMm/1000);
```
Apply inside `resolveWall` and `resolveLinear` whenever `lap > 0`. Record in `assumptions_json.splice_count` and `assumptions_json.stock_length_m`. Stock length comes from `standard?.naming_rules?.stock_length_m` if set, else 18 (≈60 ft).

### Patch F — RSIC hook addition (gap #7)
Add `hookAddMm(sizeKey, hookType)` driven by `standard?.hook_defaults` (already exists on `standards_profiles`) with RSIC defaults (e.g. 90° hook = 12·db, 180° = 6·db + 4·db tail). Add to bar length only when description includes `HOOK|HK|180|135|STD HK` or item is a stirrup/tie. Record `assumptions_json.hook_addition_mm`.

### Patch G — Segment integrity score (closes the loop)
After all patches, write `segments.confidence` = harmonic mean of (item confidences) × (1 − %outlier rows) × (1 − cross-engine-delta). Currently confidence is set elsewhere ad-hoc; making it deterministic gives the regression harness a single numeric target.

## Migration

One small migration to add `assumptions_json` keys is unnecessary (jsonb is schemaless). No DDL required for A–G.

Optional: add `standards_profiles.stock_length_m numeric default 18` so Patch E is configurable per profile. This is a 1-line migration.

## Files touched

- `supabase/functions/auto-estimate/index.ts` (Patches A–G)
- `supabase/migrations/<ts>_stock_length.sql` (optional, Patch E)

No UI files change. No edge function deletes. Existing logic preserved; all new behavior is additive and gated by data presence (e.g. WWM area extraction failure → unresolved, never silent zero).

## Expected accuracy delta

Combined the 7 patches close the known systematic error sources. Projected after harness re-run:
- Weight error: from current ~3% target → **<0.5%** on standard projects, <1.5% on heavy-bar / WWM-mixed.
- Missing items: from <1% → **<0.2%** (mass-table gap was the largest silent-zero source).
- Cross-engine drift: now bounded and surfaced, not absorbed.

After approval I'll implement A→G in that order and stop for the regression harness delta before any further tuning.