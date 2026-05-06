
## Goal
Use `LONDON_CRU1` (CRU-1 Architectural + Structural PDFs → estimate XLSX → SD06–SD12 shop drawings) as a **reference of how good output looks**. Generalise the lessons across the pipeline; do not lock the app to this project's scope (next project may be a hospital, a bridge, etc.).

## Findings from the sample

### A. Estimate XLSX (what good looks like)
- One sheet, header legend block on top:
  - Bar mass table `10M..35M` (kg/m), grade note (`400R`), concrete strength (`35 MPa`), inch→ft conversion table.
- Bar-list grammar — every row has these 9 columns in order:
  `SL.No | Identification | Multiplier | Qty | Bar Dia | Length (in) | Length (mm) | Bend | Total Length (m) | Total Wgt (kg) | Notes`
- Hierarchy: **Bucket header (FOOTING / PIER / STEP-ON-GRADE / SLAB-ON-GRADE / WALL …) → element id (F1, F2, P1, FW …) → bars under that element**.
- WWM rows store **area (SQ M)** in the length cell, not weight.
- Identification string follows `<size>MM @<spacing> <position>` (e.g. `15MM @250 MM BEW`, `4 15MM VERTICAL`, `10MM @300 MM TIES 3 SET`, `15MM@406 DOWELL`).

### B. Shop Drawings PDF (what good looks like)
- Per-pour sheets (W1 elevation, W3 elevation, footing schedule, …) annotated with grid (1, 1.1, 1.2 / A, B, C / G1..G11) and elevation labels (`B/FTG.EL.`, `T/FTG.`, `T/SOG`, `T/WALL`, `T/PIER`, `T/LEDGE`).
- Bar callouts in canonical grammar:  `<qty> <size>M B<mark> @<spacing> <position>`
  - `BS<n>` for **straight** marks, `B<n>` for **bent** marks.
  - Positions: `TOP CONT.`, `TOP ADD'L`, `BOT. CONT.`, `D/V`, `TIES`, `TOP TIES`, `VERT.`, `DIAG.`, `DWL.`, `SLAB DWL.`, `COR.`.
  - Suffix `IF` on continuous bars = "if needed".
- Footing schedule sheet: `MARK | SIZE (LxWxD) | QTY | REINFORCEMENT (ref. detail) | REMARKS`.
- "ENG. PLEASE VERIFY …" notes = uncertainty markers (already maps to `UNVERIFIED_ASSUMPTION`).

### C. Universal axiom (cross-project)
- **Wherever there is concrete, there is rebar.** Any concrete element discovered in the structural drawings (footing, pier, pile cap, wall, column, beam, slab, SOG, frost wall, ledge, stair, retaining wall, grade beam, pile, mat, raft, equipment pad, curb, stoop, …) MUST have at least one rebar entry — otherwise raise a `MISSING_REBAR` validation issue against that segment.

## Changes (minimum patch)

### 1. Lock the bar-list column contract
File: `src/lib/excel-export.ts` — `buildBarListSheet`.
- Reorder/rename headers to the canonical 11-column order from §A. (`Length (in)` and `Length (mm)` both required; current export merges them as "Length ft-in" + "Length mm" — keep `Length (in)` as the inches integer + fraction and keep `Length (mm)` numeric.)
- Group order: bucket header (Yellow merged) → element id (Light-blue merged sub-row) → bar rows. Use `b.element_id` for the sub-row instead of `b.sub_element || b.description` so `F1`, `P3`, `W1` come through verbatim.
- WWM rows: write area into the `Total Length (Mtr.)` cell with unit suffix `SQ M`, write `—` in `Total Wgt kg` (matches sample).
- Add the legend block above the headers (bar mass table + grade + concrete + inch→ft table) — pulled from `scopeData.standardsLegend` with sensible defaults.

### 2. Bucket-aware estimator (`auto-estimate`)
File: `supabase/functions/auto-estimate/index.ts`.
- Replace the binary `hasStructuralFoundation/hasStructuralSuper` heuristic with a generic **5-bucket detector** (FOUNDATION / VERTICAL / HORIZONTAL / SLAB / MISC) keyed on tokens, not file names. Buckets are emitted in the system prompt as a checklist; AI must justify which buckets are PRESENT/ABSENT and cite the OCR token.
- Append axiom to the system prompt: *"Wherever the drawing shows concrete (footing, pier, wall, column, beam, slab-on-grade, suspended slab, stair, grade beam, pile cap, mat, ledge, curb, equipment pad, retaining wall, frost wall, stoop, …) there MUST be rebar. If you find concrete with no callouts, emit a single placeholder line with `confidence: 0.1`, `description: "<elem> — UNRESOLVED rebar"`, qty/length/weight = 0."*
- Add post-processing: after parse, walk the structural OCR text for known concrete keywords; for any keyword present that has zero matching `description`, insert a `MISSING_REBAR` row into `validation_issues` (severity=Error, blocks approval per existing gating rules).

### 3. Bar-mark prefix policy in `auto-bar-schedule`
File: `supabase/functions/auto-bar-schedule/index.ts`.
- Extend the system prompt: *"Use prefix `BS` for STRAIGHT shape_code, `B` for any bent shape (L/U/Z/hook/stirrup/closed). When falling back to synthetic marks, follow the same prefix rule."*
- Synthetic mark generator: replace `M${n}` with `BS${n}` / `B${n}` according to `shape`.

### 4. Shop drawing callout grammar
File: `supabase/functions/generate-shop-drawing/shop-drawing-template.ts`.
- Add a `formatCallout(bar)` helper that emits exactly:
  `${qty} ${size} ${prefix}${mark} ${spacing? "@"+spacing : ""} ${position}`
  where `prefix` derives from `shape_code` per §3 and `position` is taken from `bar.info1` (or inferred: `TIES`/`TOP TIES` for stirrups, `D/V` for verticals, `TOP CONT.`/`BOT. CONT.` for continuous longitudinals, `DWL.` for dowels).
- Use this helper in every elevation/section view that currently prints `bar_mark` raw.
- Add a **Footing Schedule** sheet generator (one table sheet) when ≥3 footing-type elements exist: columns `MARK | SIZE (LxWxD) | QTY | REINFORCEMENT | REMARKS`. Source values from `segments.metadata.dimensions` with `—` placeholder + UNVERIFIED flag if missing.

### 5. Element-id passthrough in takeoff/confirm
File: `src/features/workflow-v2/takeoff-data.ts`.
- Surface `bar_items.element_id` (and fall back to first token of `description`, e.g. `F1`, `P3`) into `WorkflowTakeoffRow.element_id`. ConfirmStage already groups by segment; expose this on the row tooltip so the estimator can see "F1 → 10× 15M …".

### 6. Concrete = Rebar validation gate
New file: `src/lib/validation/concrete-rebar-gate.ts` (~50 lines, pure function).
- Input: `{ concreteKeywordsFound: string[], estimateRows: any[] }`.
- Output: list of `MISSING_REBAR` issues.
- Wire into `auto-estimate` post-processing (#2) and into the existing 6-gate validation in `useWorkflowState`/scope stage.
- Add to the validation-gates memory (`mem://logic/validation-gates`) as gate #7.

### 7. Regression fixture (sample preservation)
- Create `tests/fixtures/london-cru1/` containing:
  - `inputs/CRU-1_Architectral.pdf`, `inputs/CRU-1_Structural.pdf`
  - `expected/estimate.xlsx` (the user's `LONDON_CRU1-3.xlsx`)
  - `expected/shop_drawings.pdf` (the user's `SD06_TO_SD12-3.pdf`)
  - `manifest.json`: project type, expected total weight (sum of the kg column ≈ recompute on load), expected element ids per bucket, list of canonical positions and bend types observed.
- Add `src/test/fixtures/london-cru1.spec.ts` that loads the manifest and asserts:
  - parser detects all 5 buckets present in the manifest (FOUNDATION + VERTICAL + SLAB present; HORIZONTAL absent in this sample — the test asserts the absent set too).
  - `concrete-rebar-gate` returns no MISSING_REBAR issues against the expected estimate.
  - bar-list exporter produces the canonical 11 columns.
- This is **data**, not logic — adding new fixtures later (a hospital, a bridge) requires only a new folder; nothing in the engine is hard-coded to LONDON.

### 8. Memory updates
- `mem://logic/calculation-integrity`: add **"Concrete=Rebar axiom — every concrete element implies ≥1 rebar line; missing → MISSING_REBAR Error issue."**
- `mem://logic/engineering-standards`: add **"Bar-mark prefix: `BS` straight, `B` bent. Callout grammar: `<qty> <size>M <prefix><mark> @<spacing> <position>`."**
- `mem://features/reporting-and-results`: add **"Excel bar-list canonical 11 columns and bucket→element→bar hierarchy; legend block on top."**
- New memory `mem://testing/fixtures` referencing `tests/fixtures/<project>/manifest.json` convention.

## Out of scope
- No DB migrations.
- No UI redesign — only TakeoffStage tooltip surface change.
- No new edge functions — only edits to `auto-estimate`, `auto-bar-schedule`, `generate-shop-drawing`.
- No hard-coded LONDON values in production code paths; sample lives only under `tests/fixtures/`.

## Files touched
1. `src/lib/excel-export.ts` — column contract + legend block
2. `supabase/functions/auto-estimate/index.ts` — bucket detector + axiom prompt + post-process
3. `supabase/functions/auto-bar-schedule/index.ts` — BS/B prefix rule
4. `supabase/functions/generate-shop-drawing/shop-drawing-template.ts` — callout grammar + footing schedule sheet
5. `src/features/workflow-v2/takeoff-data.ts` — element_id passthrough
6. `src/lib/validation/concrete-rebar-gate.ts` — NEW
7. `tests/fixtures/london-cru1/**` — NEW (sample data + manifest)
8. `src/test/fixtures/london-cru1.spec.ts` — NEW
9. Memory files (4 updates)

## Risk
Low. All changes are additive or in-place column reorders. No schema changes. Existing exports continue to work because the new columns are a superset of today's, and the bucket detector falls back to the current heuristic when OCR text is empty.
