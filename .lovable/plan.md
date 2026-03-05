

## Plan: Production-Grade Shop-Drawing Search Database with CRM Integration

### Current State Assessment

The project already has foundational pieces in place:
- **`drawing_search_index`** table with FTS (`search_tsv`), `bar_marks` array, `confidence` scoring, GIN indexes
- **`logical_drawings`**, **`reconciliation_records`**, **`drawing_sets`**, **`document_versions`**, **`sheet_revisions`** tables
- **`search-drawings`** and **`populate-search-index`** edge functions with hybrid search (FTS + structured filters)
- **CRM integration** via `fetch-pipeline-leads` (Odoo/Rebar Shop OS) and `proxy-crm-file` edge functions
- **UI components**: `DrawingSearchPanel`, `SearchFilters`, `SearchResultCard`, `ReconciliationPanel`, `CrmSyncPanel`

The spec references "Pipeline CRM" extensively, but your actual CRM is **Odoo-based (Rebar Shop OS)**. The spec's Pipeline CRM-specific details (API keys, CSV exports, Zapier triggers) don't apply directly — your existing Odoo JSON-RPC integration is already the correct approach.

Many spec elements (pgvector embeddings, FAISS/Milvus, Python extraction tools like pdfplumber/ezdxf/IfcOpenShell, Airflow/DVC/MLflow, Mask R-CNN/U-Net) are **not implementable** in a Lovable project (no Python backend, no pgvector extension, no GPU compute). The plan below maps the spec's goals to what's achievable.

---

### Phase 1: Schema Hardening and Audit-Grade Metadata

**Database migration** to add missing columns from the spec that improve traceability:

```sql
-- Add provenance and quality columns to drawing_search_index
ALTER TABLE public.drawing_search_index
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS source_system text DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS extraction_version text DEFAULT '2026.03.05',
  ADD COLUMN IF NOT EXISTS quality_flags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false;

-- Add revision chain tracking to logical_drawings
ALTER TABLE public.logical_drawings
  ADD COLUMN IF NOT EXISTS revision_chain_id uuid,
  ADD COLUMN IF NOT EXISTS latest_revision_code text;

-- Add CRM provenance fields to drawing_search_index
ALTER TABLE public.drawing_search_index
  ADD COLUMN IF NOT EXISTS pipeline_file_id text,
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id text;

-- Add change_orders support to estimate_outcomes
ALTER TABLE public.estimate_outcomes
  ADD COLUMN IF NOT EXISTS change_orders jsonb DEFAULT '[]';
```

**Files**: Single migration file.

---

### Phase 2: Enhanced Ingestion Pipeline (`populate-search-index`)

Update the edge function to:
1. **Accept SHA-256 hash** from the client (computed during PDF upload) and store it for exact dedup
2. **Near-duplicate detection**: Before inserting, check if same SHA-256 already exists; if so, create a `file_occurrence` link instead of duplicating
3. **Quality flags**: Compute and store flags like `["ocr_used", "missing_scale", "missing_sheet_id"]`
4. **Revision chain logic**: Auto-link revisions for the same sheet_id by assigning a shared `revision_chain_id` on `logical_drawings`
5. **Improved bar mark extraction**: Expand the regex to handle more patterns (`BM-xxx`, numeric-alpha like `12A`)
6. **Store extraction_version** for reproducibility

**File**: `supabase/functions/populate-search-index/index.ts`

---

### Phase 3: CRM-to-Search-Index Auto-Sync

Update the CRM flow so that when a lead's files are fetched and processed:
1. After `proxy-crm-file` fetches a file, compute SHA-256 in the browser before upload
2. Store `crm_deal_id` and `pipeline_file_id` (Odoo attachment ID) on the search index entry
3. Add a **"Sync CRM Files to Search DB"** button in `CrmSyncPanel` that bulk-indexes all lead attachments

**Files**: `src/components/crm/CrmSyncPanel.tsx`, client-side SHA-256 utility

---

### Phase 4: Enhanced Search with Revision Chain and Change Order Filters

Update `search-drawings` RPC and edge function to support:
1. **Revision chain retrieval**: New filter `revision_chain_id` to get all revisions of a sheet
2. **Change order filter**: Filter by linked change orders on estimate_outcomes
3. **Drawing set filter**: Already partially supported via `drawing_set_id`
4. **Confidence threshold**: Option to exclude low-confidence results (< 0.7)
5. **Result explanation**: Return `match_reasons` array explaining why each result matched

Update `SearchFilters` UI to expose revision chain browsing and confidence threshold.

**Files**: 
- Database migration (update `search_drawings` RPC function)
- `supabase/functions/search-drawings/index.ts`
- `src/components/search/SearchFilters.tsx`
- `src/components/search/SearchResultCard.tsx` (show match reasons, revision chain link)

---

### Phase 5: Reconciliation Workflow Enhancement

Upgrade `ReconciliationPanel` to handle the spec's reconciliation patterns:
1. **Issue types**: Support `REVISION_CHAIN_AMBIGUOUS`, `MISSING_SHEET_ID`, `DUPLICATE_DETECTED`, `MISSING_DEAL_LINK`, `DRAWING_SET_TO_ESTIMATE_LINK`
2. **Resolution workflow**: Add resolve/waive actions with notes
3. **Quality gate**: Show count of unresolved issues blocking "production index" status
4. **Auto-generated issues**: The ingestion pipeline already creates `REVISION_CHAIN_AMBIGUOUS` records; extend to create records for missing sheet IDs and duplicates

**Files**: `src/components/audit/ReconciliationPanel.tsx`

---

### Phase 6: SHA-256 Client-Side Hashing Utility

Add a utility to compute SHA-256 in the browser using the Web Crypto API, used during PDF upload to enable exact dedup.

**File**: `src/lib/file-hash.ts`

```typescript
export async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}
```

---

### What Is NOT Implementable in Lovable

The following spec items require infrastructure outside Lovable's capabilities:
- **pgvector / embeddings**: Requires Postgres extension not available in Lovable Cloud
- **Python extraction tools** (pdfplumber, pdfminer, ezdxf, IfcOpenShell, Tesseract, TrOCR, Donut, LayoutParser): No Python runtime
- **ML models** (Mask R-CNN, U-Net, CLIP, LayoutLMv3, ColBERT, SBERT): No model hosting
- **Airflow, DVC, MLflow**: No orchestration infrastructure
- **Great Expectations**: No Python data validation framework
- **FAISS/Milvus**: No separate vector DB hosting
- **DXF/IFC parsing**: No native support in browser/Deno

These would need a separate backend service (e.g., a Python API on a cloud VM) that Lovable edge functions could call.

---

### Implementation Order

1. Schema migration (Phase 1) — foundation for everything else
2. SHA-256 utility (Phase 6) — small, no dependencies
3. Enhanced ingestion (Phase 2) — uses new schema + hashing
4. CRM sync (Phase 3) — uses enhanced ingestion
5. Enhanced search (Phase 4) — uses new schema fields
6. Reconciliation workflow (Phase 5) — uses all above

Estimated scope: ~6 files modified, 2 new files, 1 database migration.

