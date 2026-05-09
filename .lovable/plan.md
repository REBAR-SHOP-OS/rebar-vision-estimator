# 6-Phase Rebar Takeoff — Full Integration

Encode the human estimator's 6-phase methodology (Specs → Foundation → Verticals → Flatwork → Hidden Details → Convert) as a **global default** across three layers:

1. **Agent Brain knowledge rules** — persistent, citable
2. **TakeoffStage UI checklist** — visible per-segment progress
3. **auto-estimate edge function** — programmatic phase walk + missing-data flags

No DB schema changes. No new tables. Minimum-patch policy.

---

## 1. Agent Brain — global rules

Insert ~8 system rules into `public.agent_knowledge` with `user_id = NULL`-equivalent global flag (use existing service-role seed pattern; if no global flag exists, seed per-user on first load via a migration that loops through existing users, OR add `is_system boolean default false` mirroring `scope_templates`).

**Preferred:** add `is_system boolean default false` to `agent_knowledge` and update RLS to `is_system OR auth.uid()=user_id` for SELECT. Then seed system rules.

Rules to seed (each ~150–400 chars, type=`rule`):

- **R1 Specs first** — Before any quantity, extract bar grade (default 400 MPa CSA), lap table, hook table, coating. Cite sheet (e.g., S-0.2, S-5.0, S-6.0). If missing → flag `UNVERIFIED_ASSUMPTION`.
- **R2 Epoxy multiplier** — Coated bars: lap × 1.5. Apply only when "epoxy" is explicit in spec notes.
- **R3 Continuous wall footings** — Total length = perimeter (from grids) + Σ laps. Multiply by bar count from schedule (e.g., WF-1 = 2 top + 2 bottom = 4 × 20M).
- **R4 Pad footings** — Per mark: bars per side = floor((L − 2·cover) / spacing) + 1. Total per pad = bars E.W. × 2 directions. Multiply by count of that mark on plan.
- **R5 Piers/columns** — Verticals: count from schedule × (height + lap + hook). Ties: floor(height / spacing) + 1, length = perimeter of tie − 2·cover + hook ext.
- **R6 Mesh (WWF)** — Weight = mass(kg/m²) × area(m²). Add 10–15% lap waste. NEVER × linear m. Slab thickenings: +3 × 15M continuous per interior partition run (T.D.9-style detail).
- **R7 Hidden rebar** — Always scan typical-detail sheet (Sxx.x series) for: corner bars (T.D.13), opening trim (2 × 20M T&B), dowels (S-1.0 Note 5-style), step bars (T.D.3).
- **R8 Conversion table** — 10M=0.785, 15M=1.570, 20M=2.355, 25M=3.925, 30M=5.495, 35M=7.850 kg/m. Authority: RSIC 2018. LOCK these values; never AI-derive.

Phase order rule (R0): Always execute Phase 1 → 6 in sequence; never skip Phase 1.

---

## 2. TakeoffStage UI — 6-phase checklist (per segment)

Edit only `src/features/workflow-v2/stages/TakeoffStage.tsx`.

Add a collapsed phase-strip below each segment header (above the existing element rows):

```text
[1 Specs ✓] [2 Foundation ⏳] [3 Verticals —] [4 Flatwork —] [5 Hidden —] [6 Convert —]
```

State derived from existing data — no new tables:
- **Phase 1** ✓ when `bar_items.grade_source` AND `lap_source` populated (or rule R1 cited in row's `assumptions_json`).
- **Phase 2** ✓ when at least one `estimate_items.item_type='rebar'` row for footing-type segments has `total_length>0` AND assumption cites a lap value.
- **Phase 3** ✓ when piers/columns segments produce verticals + ties rows.
- **Phase 4** ✓ when mesh/WWF rows include `area` derivation (reuse the existing `wwm:` derivation marker).
- **Phase 5** ✓ when ≥1 row references a typical-detail sheet (`source_refs` contains `T.D.` or `S-6`).
- **Phase 6** ✓ when all rows have `total_weight>0` and pass the LOCKED kg/m table check.

Each chip is clickable → scrolls to first row that satisfies/blocks that phase. Failing phase shows the missing rule in tooltip ("R5: pier ties spacing not found").

No business-logic changes — UI reads existing fields.

---

## 3. auto-estimate edge function — phase walk + math

Edit only `supabase/functions/auto-estimate/index.ts`. Existing structure already has lap/hook/WWM logic. Add:

**Prompt additions** (system prompt block ~line 1429):
- Insert "PHASE WALK" section instructing the model to emit one row group per phase 1–6, with `phase: 1..6` field on each line item.
- Reference rules R0–R8 verbatim (same strings as Brain seeds, kept in a `PHASE_RULES` const so Brain + edge stay in sync).

**Math layer additions:**
- `computePerimeterFromGrids(graph)` — sum grid bay dimensions on outermost gridlines; output meters with provenance `{source: "grid_dimensions", samples: [...]}`. Used by Phase 2 wall-footing rows when no explicit perimeter is in OCR.
- `padFootingExpander(footing, schedule)` — applies R4 formula per direction; emits `derivation: "qty=floor((L−2c)/s)+1=N E.W. ×2 dir × M pads"`.
- `pierTiesExpander(pier, schedule)` — applies R5; emits ties qty + length.
- `meshWasteFactor` — bump default from current value to 1.10 (low) / 1.15 (high) controlled by `standards_profiles.waste_factors.mesh` (read existing field; default 1.12).
- `hiddenDetailsScan(graph)` — regex pass for `T\.D\.\d+`, `CORNER`, `OPENING`, `DOWEL`, `STEP` markers; each match emits a Phase-5 row with `confidence=0.5, status='draft', source_refs` populated.
- LOCK the kg/m table (R8): replace any existing kg/m lookup with a frozen `Object.freeze({...})`; reject AI-supplied weight if it deviates >0.5 % from the table value (mark row `UNVERIFIED` and overwrite).
- Each emitted row carries `phase: number` and `rule_cited: "R3"` etc. — the UI uses these for the checklist.

**Output schema** — extend each line item with `phase` and `rule_cited`. Backward compatible (optional fields).

---

## Files touched

- `supabase/migrations/<new>.sql` — `ALTER TABLE agent_knowledge ADD COLUMN is_system boolean DEFAULT false;` + update SELECT RLS + INSERT ~9 system rule rows.
- `src/features/workflow-v2/stages/TakeoffStage.tsx` — add `<PhaseChips segment={g} />` component + helpers.
- `supabase/functions/auto-estimate/index.ts` — add `PHASE_RULES`, perimeter/pad/pier/hidden helpers, phase tagging on output, LOCK kg/m table.
- `src/components/chat/BrainKnowledgeDialog.tsx` — minor: show 🔒 badge on `is_system` rules (read-only).

## Out of scope

- Shop-drawing generation changes
- Quote/estimate version schema
- Reconciliation thresholds
- Any UI redesign outside the phase-chip strip

## Verification

- Open existing project 38c049c8… → TakeoffStage shows 6 chips per segment; chips reflect current data.
- Re-run auto-estimate on a footing segment → output rows carry `phase` + `rule_cited`; perimeter derived from grids when OCR lacks it.
- Brain dialog lists the 9 new system rules with 🔒 badge.
- Weight rows for 15M → exactly 1.570 kg/m (LOCKED); any AI deviation logged.
