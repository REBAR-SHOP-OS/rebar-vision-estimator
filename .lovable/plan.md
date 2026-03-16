

## Phase 1: Data Foundation — Duplicate Prevention, Scope Source Tracking, Fallback Template

### Problem
All projects have zero estimates, zero drawings, linkage_score L0. Projects are created with no validation. No duplicate detection. No scope source tracking. No fallback template.

### Database Migration

**Add scope source tracking columns to `estimate_versions`:**
```sql
ALTER TABLE public.estimate_versions
  ADD COLUMN IF NOT EXISTS scope_source_type text DEFAULT 'real_project',
  ADD COLUMN IF NOT EXISTS scope_source_reference text,
  ADD COLUMN IF NOT EXISTS scope_confidence numeric DEFAULT 0;
```

**Add workflow columns to `projects`:**
```sql
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workflow_status text DEFAULT 'intake',
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS normalized_name text,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid,
  ADD COLUMN IF NOT EXISTS intake_complete boolean DEFAULT false;
```

**Create `scope_templates` table for canonical fallback scopes:**
```sql
CREATE TABLE public.scope_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  scope_items text[] NOT NULL DEFAULT '{}',
  project_type text,
  description text,
  is_system boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scope_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read system templates" ON public.scope_templates
  FOR SELECT TO authenticated USING (is_system = true OR auth.uid() = user_id);
CREATE POLICY "Users can manage own templates" ON public.scope_templates
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

**Create `audit_log` table:**
```sql
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid,
  action text NOT NULL,
  details jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own audit logs" ON public.audit_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own audit logs" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
```

**Seed the "20 York" fallback template** (via insert tool, not migration):
```sql
INSERT INTO public.scope_templates (name, slug, scope_items, project_type, description, is_system)
VALUES (
  '20 York - Standard Commercial',
  '20_york',
  ARRAY['FOOTING','GRADE_BEAM','RAFT_SLAB','PIER','BEAM','COLUMN','SLAB','STAIR','WALL','RETAINING_WALL','ICF_WALL','CMU_WALL','WIRE_MESH','CAGE'],
  'commercial',
  'Canonical fallback scope template based on 20 York project. Used automatically when real scope detection fails or returns low confidence.',
  true
);
```

### New Edge Function: `supabase/functions/resolve-scope/index.ts` (~120 lines)

Accepts `{ project_id }` + auth. Logic:
1. Load the project's `scope_items`, `project_type`, drawing count, estimate count
2. If `scope_items` is non-null, non-empty, and project has drawings → return `{ source_type: "real_project", scope_items, confidence: 0.9 }`
3. Otherwise, load the `20_york` template from `scope_templates` → return `{ source_type: "fallback_20_york", scope_items, confidence: 0.3, warning: "Using fallback scope — no real scope detected from drawings" }`
4. Log to `audit_log`

### New Edge Function: `supabase/functions/check-duplicate/index.ts` (~80 lines)

Accepts `{ project_name, client_name?, address? }` + auth. Logic:
1. Normalize name (lowercase, strip punctuation, trim)
2. Query existing projects for same user with similar `normalized_name` (trigram or token overlap)
3. Return `{ is_duplicate: bool, matches: [{ id, name, similarity }] }`

### Frontend Changes

**`src/pages/Dashboard.tsx`** — Project creation with duplicate check (~30 lines changed):
- Before inserting, call `check-duplicate` edge function
- If duplicate found, show confirmation dialog: "A similar project exists: {name}. Create anyway?"
- Store `normalized_name` on insert
- Add `intake_complete` badge to project list items

**`src/components/chat/ScopeDefinitionPanel.tsx`** — Fallback scope warning (~20 lines):
- When scope is loaded, call `resolve-scope` to check source
- If `fallback_20_york`, show amber banner: "⚠ Using fallback scope (20 York). Upload drawings for accurate scope detection."
- Display `scope_source_type` badge

**`src/components/chat/ChatArea.tsx`** — Estimate persistence with scope source (~15 lines):
- When estimates are computed, persist to `estimate_versions` with `scope_source_type`, `scope_source_reference`, `scope_confidence`
- Log to `audit_log`

### Files Summary

| File | Action |
|------|--------|
| DB Migration | 4 ALTER/CREATE statements |
| DB Insert | Seed 20 York template |
| `supabase/functions/resolve-scope/index.ts` | Create |
| `supabase/functions/check-duplicate/index.ts` | Create |
| `src/pages/Dashboard.tsx` | Edit — duplicate check on create, badges |
| `src/components/chat/ScopeDefinitionPanel.tsx` | Edit — fallback warning banner |
| `src/components/chat/ChatArea.tsx` | Edit — estimate persistence + audit log |

