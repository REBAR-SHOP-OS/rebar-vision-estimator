## Problem

Current `auto-estimate` is OCR-token → AI → estimate row. It works for explicit bar list tables but collapses on SD06–SD08 style packages where bar marks (`BS31`, `B2035`, `BS80`) reference upstream geometry (footing schedules, wall elevations, lap tables, CONT/IF logic). When the AI cannot find a number, it emits `length=0, weight=0` rows that look broken instead of honestly flagging "geometry unresolved — needs engineer".

The detailer's own warnings on these sheets ("VERIFY FOOTING DIM", "VERIFY STEP LOCATIONS", "VERIFY ELEVATION") confirm this is a coordination-stage package, not a fab-ready one.

## Goal

1. Stop pretending. Replace `length=0` zero rows with an explicit `UNRESOLVED_GEOMETRY` state surfaced in the UI.
2. Add the missing middle layer: a structural reference graph (bar mark → shape → host element → geometry) before the AI is asked to compute.
3. Use AI only for token extraction + final assembly. Geometry math runs deterministically.
4. Hard-block use of architectural OCR for rebar geometry (only allowed to flag a missing concrete element).

## Scope of changes (minimal-patch, additive)

```text
SD OCR ──► [1] Token extractor (existing)
            │
            ▼
        [2] Structural Graph builder  (NEW)
            • grids, footings, walls, schedules, lap table
            • bar-mark dictionary (BSxx → shape, host)
            ▼
        [3] Reference resolver       (NEW)
            • CONT / IF / DWL / TOP / BOT chaining
            • step-footing transitions
            ▼
        [4] Geometry engine          (NEW, deterministic)
            • cut length, hooks, laps, cover deductions
            • returns { value, status: RESOLVED | UNRESOLVED, missing:[...] }
            ▼
        [5] Estimate assembler       (refactored auto-estimate)
            • inserts row with provenance + status
            ▼
        [6] UI + validation queue    (existing, extended)
```

### Files to touch

1. `supabase/functions/auto-estimate/index.ts` — refactor: stop forcing non-zero, route every line through the new resolver, write `assumptions_json.geometry_status = 'unresolved' | 'resolved' | 'partial'` and `assumptions_json.missing_refs = [...]`.
2. `supabase/functions/_shared/structural-graph.ts` — NEW. Pure TS module:
   - `buildGraph(ocrPages)` → `{ grids, footings[], walls[], schedules{}, barMarks{BS80:{shape,host,size}}, lapTable{} }`.
   - `resolveBar(mark, graph)` → `{ size, shape, hostId, qty?, devLength?, status, missing[] }`.
   - `computeDevelopedLength(shape, host, lapTable, cover)` → meters or `null`.
3. `supabase/functions/_shared/rebar-formulas.ts` — NEW. Hooks (90°/135°/180°), lap = 40·db default, cover deductions, shape-code library (Type 1/2/3/T1…T9 RSIC).
4. `supabase/functions/auto-bar-schedule/index.ts` — read `geometry_status`, do NOT silently zero-fill.
5. `src/features/workflow-v2/takeoff-data.ts` — surface `geometry_status` on each row.
6. `src/features/workflow-v2/stages/TakeoffStage.tsx` (or equivalent grid) — render badge:
   - `RESOLVED` → green, value shown.
   - `PARTIAL` → amber, value shown with asterisk + tooltip listing missing refs.
   - `UNRESOLVED_GEOMETRY` → red chip, value cell shows "—" not "0", row is auto-pushed into review queue.
7. `validation_issues` insert: one issue per `UNRESOLVED_GEOMETRY` row with `issue_type='unresolved_geometry'`, `source_refs=[{mark, host, missing}]`, severity from existing rules.

### Key behavioural rules

- Architectural OCR is **never** a geometry source for a rebar line. It can only emit a placeholder concrete element flag.
- AI prompt is reduced to: "extract bar marks, callouts, schedules, dimensions as structured JSON". No more `MANDATORY COMPUTATION` clause that drives hallucinated math.
- Geometry math lives in `rebar-formulas.ts` and is unit-testable.
- A row with `quantity_count=0 AND total_length=0` is **invalid** and must be persisted with `geometry_status='unresolved'`. Storing `0` as a real value is forbidden — the UI must read the status, not the number.
- `confidence` for unresolved rows = `0.0` (not 0.2) so they can never auto-approve.

### Resolver contract (sketch)

```ts
type ResolveResult =
  | { status: 'RESOLVED'; qty: number; devLengthM: number; weightKg: number; sources: SourceRef[] }
  | { status: 'PARTIAL'; qty?: number; devLengthM?: number; missing: string[]; sources: SourceRef[] }
  | { status: 'UNRESOLVED'; missing: string[]; sources: SourceRef[] };
```

Missing-ref tokens are human-readable: `"BS80 shape definition"`, `"wall W-3 height"`, `"footing F-12 step elevation"`, `"lap class for 20M"`, etc. These flow straight into the validation queue.

### Tests (Deno)

- `supabase/functions/_shared/structural-graph.test.ts` — given a SD08 OCR fixture, builds graph and resolves `BS80`, leaves `B2035` PARTIAL with `missing=['wall W-3 height']`.
- `supabase/functions/_shared/rebar-formulas.test.ts` — Type 1 straight, Type 7 standee, hook + lap math vs RSIC table.
- `auto-estimate` regression: ensure no row is inserted with `total_length=0` AND `geometry_status!='unresolved'`.

## Out of scope (explicit)

- No PDF re-OCR. We work off existing `drawing_search_index`.
- No new tables. `assumptions_json` already exists on `estimate_items` and is used for status + missing refs.
- No prompt change to `draft-shop-drawing-ai` or `generate-shop-drawing` in this round.
- No grid auto-detection from raster — graph is built from OCR text only for this pass; raster grid extraction is a follow-up.

## Acceptance

- Re-running estimation on CRU-1 produces three populated columns in the takeoff:
  1. RESOLVED rows with real qty/length/weight derived from the structural graph.
  2. PARTIAL rows with values + amber tooltip listing what's missing.
  3. UNRESOLVED rows showing "—" and auto-listed in the validation queue with clear missing-ref text.
- Zero rows from architectural-only sources disappear.
- Validation queue contains one issue per unresolved bar mark with the detailer's own "VERIFY …" notes attached when present.
