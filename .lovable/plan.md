# Fix OCR Accuracy Gap (Minimal Patch)

## Problem confirmed by audit

For project `a24bba42…`, OCR captured 5–75 KB of text per page (good), but the indexer only populates `bar_marks[]`. `extracted_entities.dimensions`, `bar_callouts`, and `bar_schedule_rows` are empty on **all 18 pages**. That is why downstream `estimate_items` rows have `quantity_count = 0`, `total_length = 0`, `total_weight = 0`.

Also: `CRU-1 Architectral.pdf` is stuck in `parse_status='parsing'` (never finished).

## Scope (minimal-patch policy)

Touch only the indexer + one tiny migration. No UI changes, no schema changes, no new tables.

### File 1: `supabase/functions/populate-search-index/index.ts` (~60 lines added)

Add three pure regex helpers next to the existing `extractBarMarks`:

1. **`extractBarCallouts(text)`** — captures structured bar callouts:
   - Patterns to match (in order):
     - `(\d+)\s*[-–]\s*(\d{2})M\s*@\s*(\d+)\s*(mm|o\.?c\.?)?` → `{ qty, size:'15M', spacing_mm }`
     - `(\d+)\s*[-–]\s*#(\d{1,2})\s*@\s*(\d+(?:\.\d+)?)\s*(?:"|in|ft|'|o\.?c\.?)?` → imperial
     - `(\d{2})M\s*@\s*(\d+)` → no qty, just size+spacing (drives "Need run")
   - Returns `Array<{ qty?:number, size:string, spacing?:number, spacing_unit:'mm'|'in', raw:string }>`

2. **`extractDimensions(text)`** — captures element dimensions:
   - `(\d{3,5})\s*(?:mm|MM)\b` → millimetres
   - `(\d+(?:\.\d+)?)\s*m\b(?!m)` → metres (single m, not mm)
   - `(\d+)['′]\s*[-–]?\s*(\d{1,2})?\s*["″]?` → feet/inches
   - Filter: drop values < 100mm or > 200,000mm to skip noise (bar sizes, scales).
   - Returns `Array<{ value_mm:number, raw:string }>`

3. **`extractBarSchedule(text)`** — detects a bar schedule table:
   - Trigger: a line whose tokens include ≥3 of `MARK`, `SIZE`, `LENGTH`, `QTY`, `SHAPE`, `BAR`, `WEIGHT`, `SPACING`.
   - Then parse the next ≤80 lines that match `^([A-Z]{1,2}\d{1,3})\s+(\d{1,2}M|#\d{1,2})\s+(\d+(?:\.\d+)?)\s+(\d+)` → rows of `{ mark, size, length, qty }`.
   - Returns `Array<{ mark, size, length, qty }>`.

Inject results into `p_extracted_entities` at line 427:

```ts
p_extracted_entities: {
  bar_marks: barMarks,
  bar_callouts: extractBarCallouts(rawText),
  dimensions: extractDimensions(rawText),
  bar_schedule_rows: extractBarSchedule(rawText),
  tables: page.tables || [],
  title_block: tb,
  ocr_metadata: page.ocr_metadata || null,
},
```

Bump `EXTRACTION_VERSION` to `2026.05.07`.

That's it for this function. No other call sites change shape — they read from `extracted_entities` jsonb and existing readers ignore unknown keys.

### File 2: New migration to retry the stuck Architectural PDF

```sql
-- One-shot reset of stuck arch PDF for project a24bba42…
update document_versions
set parse_status = 'pending', parse_error = null
where project_id = 'a24bba42-0120-45ce-be6d-cc5625cf24e5'
  and parse_status = 'parsing'
  and parsed_at is null;
```

The existing pipeline picks up `pending` rows on next workflow tick and re-runs OCR.

### File 3: Re-run indexer for the structural file (no code change)

After deploy, call `populate-search-index` once for the 18 already-OCR'd pages so `extracted_entities` gets backfilled. We can do this by re-invoking `process-pipeline` for the structural file — same trigger the user already uses (the "Reprocess" / re-parse path).

## Out of scope

- Changing `auto-estimate` logic — once `dimensions` and `bar_callouts` exist, the existing path will start producing real `quantity_count` / `total_length` / `total_weight`.
- Schema changes, new columns, new tables.
- UI changes in `TakeoffStage.tsx`.

## Confirmation plan after deploy

1. SQL check: `select page_number, jsonb_array_length(extracted_entities->'dimensions'), jsonb_array_length(extracted_entities->'bar_callouts'), jsonb_array_length(extracted_entities->'bar_schedule_rows') from drawing_search_index where project_id='a24bba42…' order by page_number;` — expect non-zero on most pages.
2. SQL check: arch PDF `parse_status` flips from `parsing` → `indexed`.
3. Refresh Takeoff page — expect real numbers on rows that previously showed "Need run" / 0.

Reply **approve** to apply.
