# Dimensions-First — phased rollout (find → confirm → build)

You asked to **find dimensions first, confirm them, then build the workflow**. Splitting this into 3 phases so we don't ship plumbing for data we haven't proven we can extract.

## Current project state (CRU-1 Architectral, `a24bba42…`)

| Item | Value |
|---|---|
| Files uploaded | 2 |
| Indexed OCR pages | 32 |
| Segments | 3 — Footings (1 item), Walls (5 items), Shear Walls (5 items) |
| `assumptions_json.geometry` populated | **0 / 11 items** |
| `segment_source_links` | **0** |

So today the agent has no stored geometry and no source-page links. Phase 0 below proves we can extract them before we build any UI.

---

## Phase 0 — Find & Confirm (no UI, no schema, no gates)

A one-shot **dimensions discovery script** that runs against this project only, prints results to chat, and writes nothing to permanent tables until you approve.

**What it does:**
1. Read CRU-1's 32 OCR pages from `drawing_search_index`
2. Single LLM pass (Gemini 2.5 Pro, temp=0) with a **dims-only prompt**:
   - For each of the 3 segments, find: `length_ft`, `width_ft`, `height_ft`, `thickness_in`
   - Cite source: `{ sheet_id, page_number, raw_text_snippet }`
   - Mark missing dims `null` with reason
3. Output a **review table** in chat:
   ```
   Segment      | L      | W      | H      | T    | Source       | Confidence
   Footings     | 120'-0"| 4'-0"  | —      | 18"  | S-101 p3     | 0.82
   Walls        | 120'-0"| —      | 12'-0" | 8"   | S-201 p7     | 0.74
   Shear Walls  | 60'-0" | —      | 12'-0" | 12"  | S-201 p9     | 0.69
   ```
4. **Stop.** Wait for you to confirm or correct.

**Deliverable:** chat message with the table + the raw JSON the model returned + a decision prompt: *"Look right? (a) Yes — proceed to Phase 1, (b) Numbers wrong — adjust prompt, (c) Source pages wrong — fix sheet linking first."*

**No code shipped to the app.** Pure read-only validation.

## Phase 1 — Backend gate (only if Phase 0 passes)

Same as the original Option A:
- Migration: add `dimensions_status`, `dimensions_locked_at`, `dimensions_locked_by` to `segments`
- New edge function `extract-dimensions` (productionized version of the Phase 0 script)
- Gate at top of `auto-estimate` returning 422 `DIMENSIONS_INCOMPLETE` with blocker list
- Backfill: any segment whose `estimate_items` already carry `assumptions_json.geometry` → mark `complete`
- Insert `agent_knowledge` rule "Dimensions-First Discipline"

## Phase 2 — Dimensions tab UI (only if Phase 1 stable)

- New stage in `src/features/workflow-v2/types.ts` STAGES array: `dimensions` between `scope` and `takeoff`
- New file `src/features/workflow-v2/stages/DimensionsStage.tsx` — 3-pane layout (segment list / editable table / source PDF via existing `BlueprintViewer`)
- Buttons: **Run Dimensions Pass**, **Mark Complete**, **Mark N/A**
- `TakeoffStage` / Generate Estimate button disabled until all segments = `complete | na`
- Status pills reuse Approved/Review/Blocked palette

## Files touched (each phase = its own commit)

| Phase | New | Edited | Data |
|---|---|---|---|
| 0 | none (script run only) | none | none |
| 1 | `supabase/functions/extract-dimensions/index.ts` | migration + `auto-estimate/index.ts` (~10 lines gate) | 1 backfill UPDATE, 1 `agent_knowledge` insert |
| 2 | `stages/DimensionsStage.tsx`, `DimensionsTable.tsx` | `types.ts` (add stage), `WorkflowShell.tsx` (icon + status), `TakeoffStage.tsx` (disable button + tooltip) | none |

## Out of scope
- OCR/Vision pipeline changes
- Cage estimation rules
- Shop drawing generation
- `auth` / `storage` / reserved schemas

## Acceptance — Phase 0 (this iteration)
You see a table with proposed dims for all 3 CRU-1 segments + source citations, and you reply with one of (a)/(b)/(c) above. Then we proceed to Phase 1 with confidence the extraction actually works on real drawings.
