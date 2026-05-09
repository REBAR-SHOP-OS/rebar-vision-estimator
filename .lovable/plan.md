# Rebar Takeoff — Golden Rules + Hidden Scope (Phase 2 Integration)

Build on the already-shipped R0–R8 system rules. Add 6 new global rules, 3 deterministic math enforcement points in `auto-estimate`, and 3 small UI affordances in TakeoffStage. No DB schema changes.

---

## 1. New global Brain rules (insert into `agent_knowledge`, `is_system=true`)

| ID | Title | Body |
|----|-------|------|
| **G1** | Spacing + 1 starter | `qty = floor(L / spacing) + 1`. The +1 is the starter bar; never omit it. |
| **G2** | Written > Scaled | If a dimension is written on the plan, use it verbatim. Only fall back to scale-derived measurement when no written value exists, and tag `dimension_source: "scaled"`. |
| **G3** | Clear cover | Effective rebar dimension = nominal − 2·cover. Default cover = 75 mm (earth face) unless spec overrides. Apply to pad mats and all bars cast against soil. |
| **G4** | Waste factor | Apply 7 % at the **segment total** (not per row). Configurable 5/7/10 in standards_profiles.waste_factors.global. Tag the additive line `WASTE_FACTOR_7%`. |
| **R9** | Dowels | Footing-to-wall connections require dowels per the typical detail (e.g., 15M @ 400 mm O.C.). Compute over full perimeter when a dowel detail is referenced. |
| **R10** | Slab thickenings cross-ref | Overlay architectural partition walls onto the slab plan. Each interior partition run that crosses the slab triggers the typical-thickening detail (default +3 × 15M continuous). |
| **R11** | Top-tie rule | When piers/columns have a "top-tie" or "extra ties at top" note, add 2 extra ties in the top 100 mm. |
| **R12** | Step bars | At every footing elevation change ("step"), add the L-bars and U-bars from the typical step detail. Count steps from the footing-step plan callouts. |

Total system rules will be **R0–R12 + G1–G4 = 17 rules**.

---

## 2. `auto-estimate` math enforcement (small, additive)

**Files:** `supabase/functions/auto-estimate/index.ts` only.

- **Extend `PHASE_RULES` constant** with G1–G4, R9–R12 verbatim so the AI emits matching `rule_cited`.
- **Cover-aware mat length helper** `effectiveMatLengthMm(L, coverMm = 75)` → returns `L − 2·cover`. Used by the pad-footing path.
- **Spacing+1 guard**: in any place the resolver computes `floor(L/spacing)`, ensure `+1`. Add a unit-test-style sanity assert (logged, not thrown).
- **Waste factor application**: after building the response array, append one synthetic line per segment:
  ```
  { description: "Waste factor 7%", item_type: "waste", phase: 6, rule_cited: "G4",
    total_weight: round(0.07 * sum(real weights in segment), 1), confidence: 1.0,
    assumptions_json: { waste_pct: 7, source: "G4", configurable: true } }
  ```
  Read `standards_profiles.waste_factors.global` (default 0.07) when computing the percentage.
- **Dowel auto-row**: when STRUCTURAL OCR contains `DOWEL` + a spacing pattern within 80 chars of a footing schedule, emit a Phase-5 row with `rule_cited: "R9"`, length = perimeter, qty per spacing.
- **Step-bar auto-row**: regex `\bSTEP\b.*\b(?:T\.?D\.?\s*\d+|TYP)\b` → emit Phase-5 row `rule_cited: "R12"` with `confidence: 0.4, status: "draft"` so user verifies count.
- **Written>Scaled flag**: any value resolved from the new grid_dimension calibration source (G2) is tagged `dimension_source: "scaled"` in `assumptions_json`; AI-extracted values stay `dimension_source: "written"`.

No changes to existing extraction prompt structure beyond the rule list.

---

## 3. TakeoffStage UI additions

**File:** `src/features/workflow-v2/stages/TakeoffStage.tsx` only.

- **Waste % selector** in the StageHeader right-side toolbar: `[5%] [7•] [10%]` segmented buttons; persists to `standards_profiles.waste_factors.global` via a tiny upsert. Default highlight = 7.
- **Hidden-scope chip** appears next to a segment's PhaseChips strip when ≥1 row has `rule_cited` in `{R7, R9, R10, R11, R12}`: `🔍 HIDDEN SCOPE (n)` — clickable, scrolls to first matching row.
- **Cover/waste display** in the existing rows: a tiny inline tag under the Length column showing `−2×75 cover` when `assumptions_json.cover_applied` is true, and a `+7% waste` tag on the synthetic waste row (rendered with muted styling so it visually subtotals).

UI reads the new fields defensively — old rows without them render unchanged.

---

## 4. Files touched

- `agent_knowledge` rows — INSERT 8 new system rules (no migration; data only).
- `supabase/functions/auto-estimate/index.ts` — extend PHASE_RULES, add 3 helpers, append waste row, dowel/step regex pass.
- `src/features/workflow-v2/stages/TakeoffStage.tsx` — waste selector, hidden-scope chip, cover/waste row tags.

## Out of scope

- Lap length per-size table (already R1)
- WWM mesh waste 10–15% (already R6)
- Schema changes to `estimate_items` or `bar_items`
- Shop-drawing generation
- Quote/estimate version changes

## Verification

- Brain dialog now lists 17 system rules with 🔒 badge.
- Re-run auto-estimate on a footing segment → output includes a `Waste factor 7%` line at segment end with `rule_cited: "G4"`.
- Pad-footing rows show `−2×75 cover` tag when cover applied.
- Project with corner/dowel/step OCR matches → segment shows `🔍 HIDDEN SCOPE` chip linking to those rows.
- Waste % selector toggle re-saves and re-runs apply 5/10 accordingly.
