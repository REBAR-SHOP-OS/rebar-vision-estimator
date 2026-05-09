# Encode the "Big Three + Bottom-to-Top" Methodology

Make the methodology you described the **explicit playbook** the AI follows during project classification, scope/segment generation, and takeoff ordering — so every project is identified the same way and no rebar element gets missed.

## What changes

### 1. Project-type recognition — the "Big Three"
File: `supabase/functions/detect-project-type/index.ts`

Extend the classification prompt with the three explicit identifiers, in priority order:
- **Title Block** (A-0.0 / S-0.0): keywords → Commercial: "Retail / Unit Development / Westdell"; Industrial: "Warehouse / Factory / Distribution Center"; Residential: "Multi-family / Apartment / Condominium"
- **Floor Plan** (A-2.2): storefront glass / loading docks / many small rooms
- **Framing Material** (S-1.1): OWSJ + metal deck (Comm) / W-shapes + precast (Indus) / wood trusses (Resi)

Output adds `classification_evidence: { title_block, floor_plan, framing }` so the user sees why it was classified.

### 2. Bottom-to-Top segment generation
File: `supabase/functions/auto-segments/index.ts` — extend the `commercial` and `industrial` playbooks with an ordered **bottom-to-top scan**:

```text
Step 1 — Foundation Map (S-1.0)        WF (perimeter), F-pads (grid intersections)
Step 2 — Vertical Elements             Piers, Columns, Foundation Walls (cross-ref Foundation Schedule)
Step 3 — Horizontal Flatwork           SOG + WWF (General Notes), Slab Thickenings under interior walls
Step 4 — Transitions (S-6.0 details)   Steps (TD.3), Corners (TD.13), Openings (door schedule + Detail 5)
Step 5 — Site Misc (S-6.5)             Curbs, Sign Bases (TD.87/88), Bollards
```

Each step becomes a tagged candidate group with `methodology_step: 1..5` and `bucket` mapped to the existing 5 Construction Buckets.

### 3. Hidden-scope tax scan
Add a dedicated pass that always runs on Commercial:
- **Arch Overlay**: cross-reference A-2.2 walls vs S-1.0 footings → emit `Slab Thickening` candidates (TD.37) where a wall exists with no footing.
- **Door Schedule**: every exterior door → extra top/bottom bars (Detail 5).
- **Site Steel**: scan S-6.5 for menu board / directional sign / bollard details.

These get `source: "hidden_scope"` and a note pointing to the trigger sheet/detail, so they show up in the existing Hidden Scope panel.

### 4. Takeoff ordering in UI
File: `src/features/workflow-v2/stages/TakeoffStage.tsx`

Sort segments by `methodology_step` (then bucket) so the takeoff list reads bottom-up:
WF → F-pads → Piers/Columns/Walls → SOG/Thickenings → Steps/Corners/Openings → Site misc.

### 5. Final Summary Checklist surface
File: `src/features/workflow-v2/stages/ScopeStage.tsx`

Add a small read-only checklist card on the right rail:
1. Identity (Comm/Indus/Resi)
2. Perimeter (WF LF)
3. Grid points (F-pads + Piers count)
4. Arch overlay (Slab Thickenings found)
5. Tax scan (Laps / Hooks / Corners / Openings)

Each row shows ✓ / ⚠ / — based on segment + candidate state. No new tables — purely derived from existing `segments`, `validation_issues`, and `audit_events`.

## Files touched
- `supabase/functions/detect-project-type/index.ts` (prompt + evidence payload)
- `supabase/functions/auto-segments/index.ts` (playbook entries + bottom-to-top emission)
- `src/features/workflow-v2/stages/ScopeStage.tsx` (checklist card)
- `src/features/workflow-v2/stages/TakeoffStage.tsx` (sort by methodology_step)

No DB schema changes required — `methodology_step` rides in `segments.notes` / candidate metadata, and the checklist is fully derived.

## Your starting question
You asked whether to start the takeoff with **Pad Footings** or **Slab Thickenings**.

Per the methodology itself (Step 1 = Foundation Map before Step 3 = Flatwork), the correct order is **Pad Footings first**, then Slab Thickenings during the Arch Overlay pass. I'll wire the Takeoff list to default to that order so it matches the bottom-to-top logic.
