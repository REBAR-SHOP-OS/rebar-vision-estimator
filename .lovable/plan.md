# Fine-tune Segment Finder per project type

Today `auto-segments` uses **one generic prompt** for every project (residential, commercial, industrial, infra, cage_only, bar_list_only). It guesses bar-mark prefixes (`B1001`, `BS03`…) that only match one builder's convention. That's why the same 3 generic candidates (SOG / Footings / Walls) keep showing up regardless of project — exactly what your screenshot shows.

The fix: turn the segment finder into a **project-type-driven playbook**, seeded by `detect-project-type` (already returns `primaryCategory` + `recommendedScope` + `disciplinesFound` + `hiddenScope`) and the existing `scope_templates` table.

This is a minimal, surgical change — only `auto-segments/index.ts` is rewritten internally; no DB migration is required (we reuse existing `scope_templates`, `projects.project_type`, and the new `sheet_category` / `rebar_relevant` tags from the last patch).

## What changes

### 1. Per-type playbooks (in-function, one constant)
A `PLAYBOOKS` map keyed by `project_type`, each entry contains:
- `expected_buckets` — which of the 5 construction buckets to scan for
- `naming_conventions` — typical sheet/bar-mark prefixes (S-, A-, F-, W-, P-, C-, GB-, B-, COL-…)
- `must_have_segments` — defaults the finder will create even with thin OCR (e.g. residential ⇒ Strip Footings, Basement Walls, SOG, Garage Slab; commercial ⇒ Columns L1-Ln, Elevated Slabs L1-Ln, Shear Walls, Pile Caps; industrial ⇒ Equipment Pads, Tank Bases, Crane Beams; infra ⇒ Abutments, Pier Caps, Deck, Barriers; cage_only ⇒ Caisson Cage groups by diameter)
- `forbidden_segments` — types to NEVER suggest (e.g. cage_only ⇒ no SOG, no walls; residential ⇒ no crane beams)
- `bar_mark_hints` — common prefix→element maps per builder family (configurable, with sane defaults)

### 2. Use `detect-project-type` output as the seed
`auto-segments` already has `project.project_type`. Add:
- pull `recommendedScope[]`, `disciplinesFound[]`, `hiddenScope[]` from the last `audit_events` row of type `project_classified` (already written by detect-project-type)
- if absent, fall back to playbook defaults

### 3. Use `scope_templates` table as user-overridable per-type templates
- Read `scope_templates` where `project_type = project.project_type AND (is_system OR user_id = me)`
- Pre-seed the suggestion list with each `scope_items[]` entry as a candidate segment (so commercial users get their saved playbook automatically)
- Users can edit/save their own template per project type → fine-tunes future projects without touching code

### 4. Filter by sheet category (rides on the previous #5/#8 patch)
- When iterating `drawing_search_index`, skip pages where `extracted_entities.rebar_relevant === false` for segment evidence
- But still surface **Hidden Scope** flags from architectural / civil sheets (CMU walls, depressed slabs, light pole bases) as separate suggestions tagged `source: "hidden_scope"`

### 5. Project-type-specific prompt
Rebuild the AI prompt section dynamically from the playbook so the model sees only relevant rules:
- residential → emphasize ICF, basement, SOG, garage, strip footings; ignore PT decks
- commercial → emphasize columns/levels/shear walls/PT decks; group footings by mark
- industrial → emphasize equipment pads, tank bases, secondary containment, crane beams
- infrastructure → emphasize abutments, pier caps, deck panels, barriers, MTO/OPSS callouts
- cage_only → group by cage diameter and length only; suppress everything else
- bar_list_only → ONE segment per bar mark family from the schedule

### 6. Confidence + source labels on each suggestion
Each returned segment carries:
- `confidence` (0–1) — high when found in OCR + matches playbook, lower when inferred
- `source` — `"drawing"` | `"playbook"` | `"hidden_scope"` | `"user_template"`
- `bucket` — which of the 5 construction buckets
- `evidence` — sheet IDs / bar marks where it was seen

UI already shows the "Inferred from project type" badge — it'll now show `Drawing-confirmed (S-201)` vs `Playbook default` vs `Hidden scope (A-101)`.

## Files touched
- `supabase/functions/auto-segments/index.ts` — rewrite the prompt builder + add PLAYBOOKS constant + read scope_templates + use sheet_category filter (one file, ~+150 lines)
- `src/components/workspace/...` — no UI changes required; existing candidate list renders the new fields if present (badge renders `source` if available)
- (optional) seed a few `scope_templates` rows via migration for commercial / industrial / infrastructure if not already present

## Out of scope (kept for later)
- Learning loop that tunes playbooks from approved/rejected candidates — needs a follow-up migration
- Per-user bar-mark-prefix learning — wait until we have ≥3 approved projects per user

After approval I'll implement just step 1–5 in `auto-segments/index.ts` (single-file patch).