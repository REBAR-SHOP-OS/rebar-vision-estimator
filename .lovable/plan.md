

## Phase 2: Pipeline & Processing + Remove 20 York Fallback

### Two goals
1. **Remove all "20 York" fallback logic** — scope must come from real drawing detection only. If no scope is detected, the system should clearly flag "no scope detected" and block estimation until drawings are uploaded and processed.
2. **Build the processing pipeline** — PDF ingestion jobs, drawing extraction tracking, linkage score progression, audit logging, workflow status management, and admin reprocessing.

---

### Part A: Remove 20 York Fallback

**`supabase/functions/resolve-scope/index.ts`** — Rewrite to remove fallback branch:
- If project has real `scope_items` and drawings → return `{ source_type: "real_project", ... }`
- Otherwise → return `{ source_type: "none", scope_items: [], confidence: 0, warning: "No scope detected. Upload drawings for scope extraction." }`
- Remove all references to `scope_templates` table and `20_york` slug

**`src/components/chat/ScopeDefinitionPanel.tsx`** — Remove fallback warning banner:
- Remove the `scopeSourceType === "fallback_20_york"` block (lines 247-256)
- Replace with a "no scope detected" warning when `scopeSourceType === "none"`
- Remove `scopeSourceType` prop if no longer needed, or repurpose for "none" state

**`src/components/chat/ChatArea.tsx`** — Update `persistEstimateVersion`:
- Remove `fallback_20_york` reference logic (line 881)
- Always set `scope_source_type` to `"real_project"` or `"none"`

**Database** — No need to drop `scope_templates` table (may be useful later for user-defined templates), but remove the seeded "20 York" row.

---

### Part B: Processing Pipeline

#### 1. Database Migration

Create `processing_jobs` table to track PDF ingestion and drawing extraction:

```sql
CREATE TABLE public.processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  job_type text NOT NULL DEFAULT 'pdf_ingestion',
  -- job_type: pdf_ingestion, drawing_extraction, scope_detection, estimate_generation
  input_file_id uuid,
  status text NOT NULL DEFAULT 'queued',
  -- status: queued, processing, completed, failed, retrying
  progress integer DEFAULT 0,
  result jsonb DEFAULT '{}',
  error_message text,
  retry_count integer DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own processing jobs" ON public.processing_jobs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Add `linkage_score` progression tracking — already exists on `projects` table as text (L0-L3). No schema change needed.

#### 2. New Edge Function: `supabase/functions/process-pipeline/index.ts` (~200 lines)

Orchestrates the full pipeline for a project:
1. **Validate inputs** — check `project_files` exist
2. **PDF ingestion** — for each file, create `document_versions` entry, record page count
3. **Drawing extraction** — call `populate-search-index` for each file, create `logical_drawings` and `drawing_search_index` entries
4. **Scope detection** — call `detect-project-type` with file URLs, update `projects.scope_items` and `project_type`
5. **Linkage score update** — compute L0→L3 based on:
   - L0: project created, no files
   - L1: files uploaded, no drawings indexed
   - L2: drawings indexed, scope detected
   - L3: estimates created, full pipeline complete
6. **Workflow status update** — progress through: intake → files_uploaded → drawings_indexed → scope_detected → estimated
7. Log each step to `audit_log`

#### 3. Reprocessing Support

Add a "Reprocess" button in ChatArea or project header:
- Calls `process-pipeline` edge function
- Creates new `processing_jobs` entries
- Shows progress via polling or realtime
- Resets `workflow_status` to `files_uploaded` and re-runs extraction + detection

**`src/components/chat/ChatArea.tsx`** changes:
- After file upload completes, auto-invoke `process-pipeline` 
- Show processing status indicator (ingesting → extracting → detecting)
- Update `onStepChange` based on pipeline progress

**`src/pages/Dashboard.tsx`** changes:
- Show `workflow_status` badge on each project in sidebar (intake/processing/ready/estimated)
- Show `linkage_score` badge (L0-L3)
- Add "Reprocess" button (RefreshCw icon) per project

#### 4. Linkage Score Logic (in `process-pipeline`)

```text
L0 = no files, no drawings, no scope, no estimates
L1 = files exist but no drawings indexed
L2 = drawings indexed + scope detected from real drawings
L3 = estimates exist with scope_source_type = "real_project"
```

Update `projects.linkage_score` after each pipeline step.

---

### Files Summary

| File | Action |
|------|--------|
| DB Migration | Create `processing_jobs` table |
| DB Delete | Remove "20 York" row from `scope_templates` |
| `supabase/functions/resolve-scope/index.ts` | Rewrite — remove fallback, return "none" |
| `supabase/functions/process-pipeline/index.ts` | Create — pipeline orchestrator |
| `supabase/config.toml` | Add `process-pipeline` function |
| `src/components/chat/ChatArea.tsx` | Update estimate persistence, auto-trigger pipeline after upload |
| `src/components/chat/ScopeDefinitionPanel.tsx` | Remove fallback banner, add "no scope" warning |
| `src/pages/Dashboard.tsx` | Add workflow_status + linkage_score badges, reprocess button |

