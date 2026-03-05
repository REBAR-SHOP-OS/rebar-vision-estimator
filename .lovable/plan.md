

## Plan: Shop Drawing Search Database with CRM Integration

This is a large system. The plan is split into 4 phases, each delivering usable value. Given Lovable's constraints (React frontend, Supabase/Postgres backend via Edge Functions), we use **PostgreSQL full-text search + JSONB + GIN indexes** as the primary search engine, with pgvector as an optional future addition.

### What Already Exists

Your project already has strong foundations:
- `document_versions` (SHA-256 hashing, file tracking)
- `drawing_sets` + `sheet_revisions` (revision chains, title block metadata)
- `reconciliation_records` (audit trail)
- `symbol_lexicon` (rebar notation patterns)
- `extract-pdf-text` edge function (PDF text + table extraction)
- CRM pipeline integration (fetch-pipeline-leads, proxy-crm-file)

### Phase 1: Search Schema + Index Population

**Database migration** -- new tables and indexes:

```text
logical_drawings
├── id (uuid PK)
├── project_id → projects
├── user_id
├── sheet_id (text, e.g. "S-201")
├── discipline (text)
├── drawing_type (text)
├── unique(user_id, project_id, sheet_id, drawing_type)

drawing_search_index
├── id (uuid PK)
├── user_id
├── logical_drawing_id → logical_drawings
├── document_version_id → document_versions
├── sheet_revision_id → sheet_revisions
├── project_id → projects
├── page_number (int)
├── extracted_entities (jsonb) -- bar_marks[], schedule_rows[], etc.
├── raw_text (text)
├── search_tsv (tsvector) -- GIN-indexed for FTS
├── bar_marks (text[]) -- GIN-indexed for exact lookups
├── crm_deal_id (text)
├── revision_label (text)
├── issue_status (text)
├── created_at
```

Add GIN indexes on `search_tsv`, `bar_marks`, and `extracted_entities`.

RLS: user can only access own rows (`auth.uid() = user_id`).

**Populate on ingestion**: Modify the estimation pipeline (after `extract-pdf-text` runs) to insert rows into `drawing_search_index` with the extracted text, detected bar marks, and title block metadata. This happens in the existing `analyze-blueprint` flow.

### Phase 2: Search Edge Function

New edge function `search-drawings/index.ts`:
- Accepts: `{ q, project_id, sheet_id, bar_mark, discipline, drawing_type, revision, crm_deal_id, limit }`
- Executes hybrid query:
  1. Structured filters (project, discipline, revision, CRM deal)
  2. Full-text search via `search_tsv @@ plainto_tsquery(q)`
  3. Array containment for bar marks: `bar_marks @> ARRAY[bar_mark]`
- Returns ranked results with highlights via `ts_headline()`
- Uses `supabase.rpc()` calling a security-definer function for the complex query

### Phase 3: Search UI

New sidebar button "Search Drawings" that opens a search panel:
- Search bar with type-ahead
- Filter chips: project, discipline, drawing type, revision, CRM deal
- Results list showing: sheet ID, revision, project name, matched bar marks, snippet with highlights
- Click result → opens that project's chat with the drawing focused
- "Similar drawings" link per result (future: vector similarity)

### Phase 4: CRM Backfill + Deduplication

- Extend `fetch-pipeline-leads` to also return historical/closed deals with files
- Add a "Backfill Search DB" action in the CRM panel that:
  1. Iterates all CRM deals with files
  2. Downloads via proxy-crm-file
  3. Runs extract-pdf-text
  4. Populates logical_drawings + drawing_search_index
- Near-duplicate detection: compare SHA-256 for exact dupes; flag files with same sheet_id + different hash as revision candidates
- Reconciliation UI: surface ambiguities (revision conflicts, missing revisions) via the existing `reconciliation_records` table

### Technical Details

**Database functions needed**:
- `search_drawings(p_user_id uuid, p_query text, p_filters jsonb, p_limit int)` -- SECURITY DEFINER function that builds the hybrid query, avoiding RLS recursion
- `upsert_search_index(...)` -- called from edge functions after extraction

**Edge functions**:
- `search-drawings/index.ts` -- thin wrapper calling the DB function
- Modifications to `analyze-blueprint/index.ts` -- after extraction, insert into search index

**Frontend components**:
- `src/components/search/DrawingSearchPanel.tsx` -- main search UI
- `src/components/search/SearchResultCard.tsx` -- individual result display
- `src/components/search/SearchFilters.tsx` -- filter controls

**pgvector (future)**: Can be added later for "find similar drawings" by storing text embeddings in a `vector(768)` column on `drawing_search_index`. Not required for Phase 1-3 since structured filters + FTS handle most real queries.

### Implementation Order

1. Database migration (logical_drawings + drawing_search_index + functions + indexes)
2. Search edge function
3. Modify analyze-blueprint to populate search index during estimation
4. Search UI panel
5. CRM backfill workflow
6. Deduplication + reconciliation enhancements

