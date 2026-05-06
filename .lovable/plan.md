# Make every QA question state the exact drawing location

## What's already in place
`takeoff-data.ts` already builds a `location` object and `location_label` for each `WorkflowQaIssue` from `validation_issues.source_refs[0]` plus `estimate_items.assumptions_json`, and prefixes `iss.title` with the label. `QAStage.tsx` shows the label inside a bordered box under the title. The pieces exist but are incomplete — the spoken **question text** (`description`) and the **list-row preview** still don't lead with the location, structured fields are not consistently extracted on the backend, and there's no source-excerpt fallback when no sheet/grid is known.

## Changes (minimal patches only)

### 1. `src/features/workflow-v2/takeoff-data.ts`
- Extend `extractLocationFromRef` to also pull `callout`, `area`, `wall`, `footing`, `pad`, `pad_name`, `wall_name`, `footing_name` into `element_reference`, and read `aj.location` / `ref.location` if backends already nest them.
- Build an enriched `question_text` on each `WorkflowQaIssue`:
  - Format: `"<location_label>: <original description or title>."`
  - If `location_label` is null, fall back to `Page <n>` and finally to `source_excerpt` (truncated to ~120 chars, prefixed with `Source: "<excerpt>"`).
- Always set `iss.description` to `question_text` so the QA panel (which renders `sel.description`) shows the location-led sentence. Keep the original message in `iss.raw_description` for debugging.
- Make sure canonical (rebar.takeoff_warnings) issues also get a real `location_label` from `takeoff_items.drawing_reference` / `extraction_payload.sheet|page|grid|detail|element` (currently it only uses a sliced UUID). Pull that data in `loadCanonicalQaIssues` via a single follow-up select on `takeoff_items`.
- Add the new structured fields onto `WorkflowQaIssue.location` type: `callout`, `wall_reference`, `footing_reference`, `pad_reference` (plus the existing six). All optional.

### 2. `src/features/workflow-v2/stages/QAStage.tsx`
- In the issue list (line 240) replace `it.description?.slice(0,50)` with `(it.location_label || "") + " — " + (it.description||"")` truncated, so each row in the left list also leads with the location.
- In the right detail panel (line 535–539) keep the boxed `location_label`, but ensure the `description` shown below is the new location-prefixed `question_text`. Also render `source_excerpt` (italic, "Source: …") if present and no grid/detail was resolved.
- The Modification mini-card (line 412) already concatenates `location_label` — keep as is.
- Drawing review panel link is already keyed off `locator.page_number` / `linked_item.page_number`; no change needed.

### 3. Backend persistence (so future issues carry structured fields natively)

**`supabase/functions/auto-estimate/index.ts`** (and any helper that writes to `validation_issues` / `estimate_items.assumptions_json`):
- When inserting a `validation_issues` row, populate `source_refs[0]` with the structured shape:
  ```json
  {
    "estimate_item_id": "...",
    "page_number": 12,
    "sheet": "S-201",
    "detail": "4",
    "grid": "B-4",
    "zone": "north foundation wall",
    "element": "F-3",
    "excerpt": "...verbatim line from drawing text..."
  }
  ```
- When writing `estimate_items.assumptions_json`, mirror the same keys (`sheet`, `detail`, `grid`, `zone`, `element`, `excerpt`, `page_number`) so the loader can reconstruct location even if `source_refs` is empty.
- No DB schema change required — both columns are already `jsonb`. Existing rows continue to work via the loader's `pickStr` fallbacks.

### 4. Verify
- Open `/app/project/3f840fa0-…` → Review → confirm each QA card's description now starts with `Sheet … · Page … · …:` and that rows without a real sheet show `Page N: …` or `Source: "…"`.
- Confirm the right-side blueprint panel still scrolls to the same page/bbox.

## Out of scope
- No new tables, no migrations, no schema changes.
- No edits to unrelated stages, no UI redesign, no rename of fields.
