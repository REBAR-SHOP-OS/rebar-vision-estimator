

## Integrate Production-Grade Shop-Drawing Search DB Specification

### Current State Assessment

Already implemented:
- `logical_drawings` table (sheet_id, discipline, drawing_type)
- `drawing_search_index` table (FTS via `search_tsv`, `bar_marks[]`, `extracted_entities` JSONB)
- `search_drawings` RPC function (hybrid FTS + structured filters)
- `populate-search-index` edge function (ingestion from analyze-blueprint)
- `search-drawings` edge function (search API)
- `DrawingSearchPanel` UI with filters
- `document_versions` table with SHA-256 hashing
- `reconciliation_records` table
- `symbol_lexicon` table

**Not yet implemented** (from the spec):
1. **Near-duplicate detection** (perceptual hashing) -- out of scope for this phase
2. **Drawing packages / issue sets** -- `drawing_sets` table exists but not linked to search index
3. **Embeddings (pgvector)** -- not installed, no embedding columns -- future phase
4. **Multi-granularity indexing** (table-level, row-level, symbol-level) -- currently page-level only
5. **Ingestion manifest** -- no formal manifest system
6. **Pipeline CRM file linkage in search index** -- `crm_deal_id` column exists but not populated during auto-ingestion
7. **Data quality checks / hard-block / soft-block logic** -- not implemented in populate-search-index
8. **Revision chain conflict detection** -- not implemented
9. **Search result overlays/highlights** -- not in UI

### What to Implement Now (Pragmatic Phase 1)

Given the existing infrastructure, the highest-value changes are enhancing what already works rather than building new systems from scratch.

**1. Enhance `populate-search-index` with data quality checks**
- Add hard-block logic: skip indexing if `project_id` missing or `raw_text` empty (already partially done)
- Add soft-block: set a `confidence` field based on text quality, bar mark extraction count
- Add revision chain conflict detection: when upserting a logical drawing, check if an existing entry has a different revision label for the same sheet_id → create a `reconciliation_records` entry
- Link `drawing_set_id` and `document_version_id` when available

**2. Enhance `search-drawings` with additional filters**
- Add `drawing_set_id` filter support
- Add `sheet_id` partial match (ILIKE) for fuzzy sheet lookups
- Add sorting options (by date, by relevance, by sheet_id)

**3. Auto-populate search index from analyze-blueprint pipeline**
- After PDF text extraction in `analyze-blueprint`, automatically call the `upsert_search_index` RPC with extracted data
- This closes the gap where pages are extracted but never indexed

**4. Enhance UI with revision timeline and CRM linkage display**
- Show revision history when available in `SearchResultCard`
- Add CRM deal name (not just ID) by joining `crm_deals` table in the search RPC
- Add "confidence" indicator to search results

### Files to Change

| File | Changes |
|---|---|
| `supabase/functions/populate-search-index/index.ts` | Add data quality checks, confidence scoring, revision conflict detection, reconciliation record creation |
| `supabase/functions/search-drawings/index.ts` | Add partial sheet_id match, drawing_set filter, sort options |
| `supabase/functions/analyze-blueprint/index.ts` | After PDF extraction, auto-call `upsert_search_index` to populate search DB |
| `src/components/search/SearchResultCard.tsx` | Show confidence indicator, revision info |
| `src/components/search/SearchFilters.tsx` | Add project filter dropdown |

### Database Migration

Add a `confidence` column to `drawing_search_index`:
```sql
ALTER TABLE public.drawing_search_index 
  ADD COLUMN IF NOT EXISTS confidence numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS drawing_set_id uuid;
```

Update `search_drawings` RPC to include confidence in results and support partial sheet_id matching.

### Technical Details

**Data Quality Scoring** in `populate-search-index`:
- Start at 1.0
- Subtract 0.1 if no bar marks extracted
- Subtract 0.2 if raw_text < 50 chars
- Subtract 0.1 if no title block metadata
- Subtract 0.2 if sheet_id is null

**Revision Conflict Detection**:
- When inserting for a logical drawing, query existing entries for same `sheet_id` + `project_id`
- If existing `revision_label` differs from new one, create a `reconciliation_records` entry with `issue_type = 'REVISION_CHAIN_AMBIGUOUS'`

**Auto-indexing from analyze-blueprint**:
- After the PDF text extraction block (around line 1434), call the `upsert_search_index` RPC for each extracted page
- Use the already-parsed title block metadata for sheet_id, discipline, drawing_type

