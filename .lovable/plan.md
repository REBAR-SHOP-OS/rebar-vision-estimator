

## Plan: Production-Grade Estimator/Detailer — Phased Implementation Within Current Stack

This is a massive vision document. Let me map what's already built, what can be implemented now within Lovable's React + Supabase Edge Functions stack, and what requires external infrastructure later.

### What Already Exists

- **PDF ingestion**: `extract-pdf-text` (pdfjs-serverless) + `analyze-blueprint` (Google Vision OCR + Gemini AI extraction)
- **9-stage estimation pipeline**: detect-project-type → extraction → validation → pricing → bar list → BBS
- **Shop drawing generation**: `generate-shop-drawing` edge function + client-side HTML builder
- **CRM integration**: `fetch-pipeline-leads` pulls from REBAR SHOP OS, `CrmSyncPanel` UI
- **Approval workflow**: multi-stage review chain (Ben → Neel → Customer) with comment polling
- **Agent Brain**: `agent_knowledge` table with rules, files, learned insights, training examples
- **Automatic learning**: extracts takeaways every 5 messages
- **Notifications**: `notify-reviewer` edge function + `notifications` table
- **Outcome tracking**: `estimate_outcomes` table with quoted vs actual fields

### What This Document Adds (Prioritized by Feasibility)

Given the Lovable stack (React frontend + Supabase Edge Functions + Postgres), here's what we can implement now vs what needs external compute:

---

#### Phase 1: Data Audit Foundation (Implementable Now)

**1. Document versioning with SHA-256 hashing**
- Already partially done in `extract-pdf-text` (computes `sha256`)
- Add a `document_versions` table storing hash, provenance, and drawing set linkage
- Add `drawing_sets` and `sheet_revisions` tables for revision lineage tracking

**2. Estimate versioning and linkage**
- Add `estimate_versions` table linking estimate snapshots to drawing sets
- Add `quote_versions` table for issued proposals
- Modify `estimate_outcomes` to reference `estimate_version_id` and `drawing_set_id`

**3. Data quality / linkage scoring**
- Add a `linkage_score` column to projects (L0-L3)
- Edge function to compute linkage completeness per project

**Database migration** (~6 new tables):
```sql
-- document_versions: immutable PDF version records
-- drawing_sets: groups of sheets issued together
-- sheet_revisions: per-sheet revision tracking
-- estimate_versions: versioned estimate snapshots
-- quote_versions: issued proposal versions
-- reconciliation_records: human resolution audit trail
```

#### Phase 2: Enhanced Extraction Pipeline (Implementable Now)

**4. Sheet-level indexing from PDF extraction**
- Enhance `extract-pdf-text` to also extract title block fields (sheet number, title, revision, scale) using pattern matching on extracted text
- Store per-sheet metadata in `sheet_revisions`

**5. Symbol lexicon for rebar notation**
- Create an `agent_knowledge` entry type `lexicon` or a dedicated `symbol_lexicon` table
- Pre-populate with standard rebar notations (bar sizes, spacing patterns, shape codes)
- Use in `analyze-blueprint` prompt to improve extraction accuracy

**6. Confidence scoring on extractions**
- Add confidence fields to extraction outputs (scale_confidence, schedule_completeness)
- Gate auto-quoting: if confidence < threshold → route to HITL

#### Phase 3: Outcome Learning Loop (Implementable Now)

**7. Outcome capture UI**
- Add fields to Dashboard for won/lost status, actual costs, change orders
- Store in `estimate_outcomes` (already exists)

**8. Delta analysis edge function**
- New edge function `analyze-outcomes` that computes:
  - Bias (systematic over/under estimation)
  - Error by project type, estimator, client
  - Generates "learned rules" from patterns
- Uses Lovable AI (Gemini) to analyze patterns and produce correction rules

**9. Active learning signals**
- Track low-confidence extractions in a `review_queue` table
- Surface them in the UI for human labeling priority

#### Phase 4: Pipeline CRM Deep Integration (Implementable Now)

**10. Full deal lifecycle sync**
- Enhance `fetch-pipeline-leads` to also pull won/lost outcomes
- Create a `crm_sync_log` table for audit trail
- Bi-directional: push estimate results back to CRM deals via Pipeline CRM API

**11. Reconciliation UI**
- New panel to resolve ambiguous drawing-to-estimate links
- Store resolution records with audit trail

#### Phase 5: Future (Requires External Compute)

These items need Python/GPU backends and cannot run in Supabase Edge Functions:
- Mask R-CNN / U-Net symbol detection (needs GPU)
- LightGBM/XGBoost delta models (needs Python runtime)
- DXF/IFC generation via ezdxf/IfcOpenShell (needs Python)
- FAISS vector search (pgvector could be added to Supabase instead)
- Great Expectations data validation (Python)
- Airflow orchestration (infrastructure)

For these, the frontend is already decoupled — future microservices can replace edge functions without UI changes.

---

### Implementation Order (What to Build First)

1. **Database schema**: `document_versions`, `drawing_sets`, `sheet_revisions`, `estimate_versions`, `quote_versions`, `reconciliation_records` tables with RLS
2. **Enhanced extract-pdf-text**: extract title block metadata (sheet number, revision, scale) from text patterns
3. **Symbol lexicon table**: pre-populate rebar notation patterns
4. **Outcome capture UI**: add won/lost and actual cost fields to project detail view
5. **Delta analysis function**: edge function using Gemini to analyze estimation accuracy patterns
6. **Confidence gating**: add thresholds to approval workflow — block auto-issue below confidence
7. **Reconciliation panel**: UI for linking drawings to estimates with audit trail

### Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Migrate | New migration | 6 tables + RLS policies |
| Create | `supabase/functions/analyze-outcomes/index.ts` | Delta analysis from outcomes |
| Edit | `supabase/functions/extract-pdf-text/index.ts` | Title block metadata extraction |
| Edit | `supabase/functions/analyze-blueprint/index.ts` | Use symbol lexicon in prompts |
| Edit | `src/components/chat/ApprovalWorkflow.tsx` | Confidence gating UI |
| Create | `src/components/audit/ReconciliationPanel.tsx` | Drawing-estimate linking UI |
| Create | `src/components/audit/OutcomeCapture.tsx` | Won/lost + actuals entry |
| Edit | `src/pages/Dashboard.tsx` | Add outcome capture + reconciliation access |

### Scope Decision Needed

This is a very large roadmap. I recommend starting with **Phase 1 (data audit schema)** + **Phase 3 (outcome capture)** as these create the foundation everything else depends on. Shall I implement all phases sequentially, or focus on a specific phase first?

