## Problem (from CRU-1 screenshot + audit)

Stage 02 shows the same archetypes ("Footings — Strip & Pad", "Walls — Foundation/Retaining", "Slabs on Grade") **once per uploaded PDF** (Structural (4).pdf AND Architectural.pdf). That is the root cause of the overlap you flagged. The candidates are not coming from OCR — `src/features/workflow-v2/stages/ScopeStage.tsx` (lines 20–40) generates them synthetically by crossing a fixed `archetypes` array with `state.files`. The real candidate generator (`supabase/functions/auto-segments`) is never invoked from Stage 02, and it already enforces "structural shows rebar; architectural shows dimensions/hidden scope" — we just aren't using its output.

`auto-estimate` already encodes the **Concrete = Rebar axiom** and a structural-first source picker (lines 174, 386), but it feeds OCR from `drawing_search_index` without weighting by discipline, so when structural pages are noisy it can silently rely on architectural numbers without flagging it.

`auto-bar-schedule` and `generate-shop-drawing` both read from `estimate_items` only — so any duplication upstream is replicated downstream into the SD callouts and bar schedule.

## Goal

1. Stage 02 candidates come from real OCR (structural primary, architectural fallback / hidden-scope), de-duplicated by element identity, never per-file.
2. `auto-estimate` ranks structural OCR first, only consults architectural to recover *missing* concrete elements (Concrete = Rebar axiom), and tags each line with the discipline it was confirmed against.
3. `auto-bar-schedule` and `generate-shop-drawing` consume the de-duplicated estimate set so SD callouts/schedules can't double-count.
4. No regressions to existing London CRU-1 fixture (`tests/fixtures/london-cru1/manifest.json`) or `concrete-rebar-gate` test.

## Changes (minimum patch)

### A. Real Stage 02 candidates — `src/features/workflow-v2/stages/ScopeStage.tsx`
- Drop the synthetic `archetypes` × `files` cross-product.
- On mount (when `state.files.length > 0` and no candidates cached), call `supabase.functions.invoke("auto-segments", { body: { projectId } })` once and persist the result in `state.local.scopeCandidates`.
- Map suggestions → `Candidate { id: name, label: name, source: notes (drawing refs), confidence, evidence: notes }`. One candidate per unique `name` — no per-file duplication.
- Keep the existing approve/reject UI and `segments` upsert path unchanged.
- Empty-state hint becomes: "Run scope detection — no concrete elements surfaced yet."

### B. Discipline-weighted OCR — `supabase/functions/auto-estimate/index.ts`
- When fetching `drawing_search_index`, also pull `extracted_entities->title_block->discipline` (already stored).
- Build two text buffers: `structuralOCR` and `architecturalOCR`. Concatenate as `structuralOCR` first, then a clearly delimited `=== ARCHITECTURAL FALLBACK (use only to recover missing concrete elements) ===` block, then architectural.
- Extend the system prompt: "Prefer values from structural pages. Only use the architectural block to add a line for a concrete element that has no structural rebar callout, and tag its description with `(arch-fallback)`. Never overwrite a structural number with an architectural one."
- Source-file picker (line 386) already prefers structural — leave intact.

### C. De-dup gate before insert — `supabase/functions/auto-estimate/index.ts`
- Before `supabase.from("estimate_items").insert(rows)`, collapse rows on `(segment_id, normalize(description), bar_size)` keeping the highest-confidence row and summing identical-geometry duplicates only when both are sourced from the same discipline.
- Re-query existing `estimate_items` for this segment and skip rows whose normalized key already exists (the current `existingDesc` is only passed to the prompt — make it an actual hard filter).

### D. Shop-drawing & bar-schedule consume the same de-duplicated set
- `supabase/functions/auto-bar-schedule/index.ts`: add the same normalization step on its `estimate_items` read (line 95) so a stray duplicate row from older runs cannot produce two BS marks.
- `supabase/functions/generate-shop-drawing/shop-drawing-template.ts`: no logic change — already iterates over what it's given. Verified via existing `src/test/shop-drawing-template.test.ts`.

### E. Tests
- Extend `src/test/concrete-rebar-gate.test.ts` (or add `auto-estimate-dedup.test.ts`) to assert: given OCR with `WALL W1` on both structural and architectural pages, only one `WALL W1` line is produced and it is tagged structural.
- Re-run `tests/fixtures/london-cru1/manifest.json` regression — bucket presence/absence must remain identical.

## Out of scope

- No DB schema changes.
- No UI redesign of Stage 02 beyond swapping the data source.
- Excel / PDF exporters untouched (last week's wiring stays).

## Files touched

- `src/features/workflow-v2/stages/ScopeStage.tsx` (replace candidate source)
- `supabase/functions/auto-estimate/index.ts` (discipline weighting + dedup gate)
- `supabase/functions/auto-bar-schedule/index.ts` (dedup read)
- `src/test/concrete-rebar-gate.test.ts` (add dedup assertion) or new test file

## Risk

Low. Stage 02 already has an empty-state branch, so if `auto-segments` returns `[]` the screen degrades gracefully instead of showing fake archetypes. All other paths are additive filters.
