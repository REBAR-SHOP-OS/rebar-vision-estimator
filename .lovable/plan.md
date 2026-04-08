

# Redesign & Extend Rebar Vision Estimator — Phased Plan

## Current State

The app has a working foundation:
- **Routing**: `/` (landing), `/auth`, `/app` (Dashboard), `/blueprint-viewer`, `/review/:token`
- **Dashboard.tsx** (603 lines): sidebar with project list, main area switches between `ProjectDashboard` (no project selected) and `WorkspaceLayout` (project selected), plus overlays for CRM, health, quotes, revisions, etc.
- **WorkspaceLayout**: 3-pane resizable layout (sidebar, estimate grid, evidence drawer) with chat toggle
- **Backend**: 20+ Supabase tables covering projects, files, estimates, drawings, reviews, CRM, audit
- **Edge functions**: 18+ functions for analysis, OCR, pipeline, shop drawings, CRM

The request asks for ~10 new screens, ~12 new DB tables, role-based auth, standards profiles, a detailing studio, and a drawing viewer with overlays. This is 3-4 weeks of work. I will break it into implementable phases.

---

## Phase 1: Database Schema + App Shell Restructure (implement now)

### 1A. New Database Tables via Migrations

Create the core new tables that the UI will consume:

```sql
-- segments: structural elements within a project
CREATE TABLE public.segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  segment_type text NOT NULL DEFAULT 'miscellaneous',
  level_label text,
  zone_label text,
  status text DEFAULT 'draft',
  confidence numeric DEFAULT 0,
  drawing_readiness text DEFAULT 'not_ready',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own segments" ON public.segments FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- estimate_items: line items within a segment
CREATE TABLE public.estimate_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  item_type text DEFAULT 'rebar',
  description text,
  bar_size text,
  quantity_count integer DEFAULT 0,
  total_length numeric DEFAULT 0,
  total_weight numeric DEFAULT 0,
  waste_factor numeric DEFAULT 1.05,
  labor_factor numeric DEFAULT 1.0,
  assumptions_json jsonb DEFAULT '{}',
  exclusions_json jsonb DEFAULT '{}',
  confidence numeric DEFAULT 0,
  status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.estimate_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own estimate_items" ON public.estimate_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- bar_items: individual bars within an estimate item
CREATE TABLE public.bar_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  estimate_item_id uuid,
  user_id uuid NOT NULL,
  mark text,
  shape_code text,
  cut_length numeric DEFAULT 0,
  quantity integer DEFAULT 0,
  size text,
  finish_type text DEFAULT 'black',
  lap_length numeric,
  cover_value numeric,
  confidence numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.bar_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own bar_items" ON public.bar_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- validation_issues: QA issues
CREATE TABLE public.validation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  segment_id uuid,
  sheet_id text,
  user_id uuid NOT NULL,
  issue_type text NOT NULL,
  severity text DEFAULT 'warning',
  title text NOT NULL,
  description text,
  status text DEFAULT 'open',
  assigned_to text,
  resolution_note text,
  source_refs jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.validation_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own validation_issues" ON public.validation_issues FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- drawing_views: draft shop drawing views per segment
CREATE TABLE public.drawing_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  view_type text DEFAULT 'plan',
  title text,
  generated_json jsonb DEFAULT '{}',
  status text DEFAULT 'draft',
  confidence numeric DEFAULT 0,
  revision_label text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.drawing_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own drawing_views" ON public.drawing_views FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- standards_profiles: admin-managed code profiles
CREATE TABLE public.standards_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  code_family text DEFAULT 'CSA A23.3',
  units text DEFAULT 'metric',
  cover_defaults jsonb DEFAULT '{}',
  lap_defaults jsonb DEFAULT '{}',
  hook_defaults jsonb DEFAULT '{}',
  naming_rules jsonb DEFAULT '{}',
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.standards_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own standards_profiles" ON public.standards_profiles FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- approvals: review/approval records
CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  segment_id uuid,
  user_id uuid NOT NULL,
  approval_type text DEFAULT 'estimate',
  status text DEFAULT 'pending',
  reviewer_name text,
  reviewer_email text,
  notes text,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own approvals" ON public.approvals FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### 1B. Routing Restructure

Update `App.tsx` to support nested routes under `/app`:

```
/app                → Dashboard (project list)
/app/project/:id    → Project workspace (tabbed)
/app/project/:id/files
/app/project/:id/segments
/app/project/:id/segments/:segId
/app/project/:id/qa
/app/project/:id/outputs
/app/project/:id/settings
/app/viewer/:id     → Drawing viewer (full-screen)
/app/standards      → Standards profiles
```

### 1C. App Shell with Left Navigation

Replace the current sidebar-in-Dashboard pattern with a proper `AppShell` component using `SidebarProvider`:
- **Left nav**: Dashboard, active project tabs, standards, settings
- **Top bar**: breadcrumbs, project name, actions
- **Main content**: routed pages

### Files Modified
- `src/App.tsx` — add nested routes
- `src/pages/Dashboard.tsx` — simplify to project list only (extract sidebar logic)

### Files Created
- `src/components/layout/AppShell.tsx` — shell with sidebar + header
- `src/components/layout/AppSidebar.tsx` — left navigation
- `src/pages/ProjectWorkspace.tsx` — tabbed project detail page

---

## Phase 2: Dashboard + Project Workspace Redesign

### 2A. Dashboard Redesign
Enhance existing `ProjectDashboard.tsx`:
- Add segment counts and issue counts per project
- Add "pending approvals" and "unresolved issues" summary cards at top
- Add quick-action cards (New Project, Recent Files, Drawing Readiness)
- Keep existing project table with health indicators

### 2B. Project Workspace with Tabs
Create `ProjectWorkspace.tsx` with tabs: Overview, Files, Segments, QA, Outputs, Settings

**Overview tab**: project metadata cards, workflow status stepper, file/segment/issue summary, estimate summary, approval status

**Files tab**: enhanced file list from existing `project_files` data with discipline, revision, parse status, superseded badges

### Files Modified
- `src/components/workspace/ProjectDashboard.tsx` — add summary cards
- `src/components/workspace/WorkspaceLayout.tsx` — integrate as "Estimate" sub-view within segments

### Files Created
- `src/pages/ProjectWorkspace.tsx`
- `src/components/workspace/ProjectOverview.tsx`
- `src/components/workspace/FilesTab.tsx`
- `src/components/workspace/SegmentsTab.tsx`
- `src/components/workspace/QATab.tsx`
- `src/components/workspace/OutputsTab.tsx`

---

## Phase 3: Segments + Estimating Workbench

### 3A. Segments List
- Table of segments with type, level, zone, status, confidence, issue count, drawing readiness
- Create/edit segment dialog
- Link segments to source sheets

### 3B. Segment Detail Page
Tabbed view: Estimate, Drawing, Issues, Sources
- **Estimate tab**: summary cards + estimate items table + bar breakdown
- **Issues tab**: filtered validation_issues for this segment
- **Sources tab**: linked source sheets with thumbnails

### Files Created
- `src/pages/SegmentDetail.tsx`
- `src/components/segments/SegmentSummaryCards.tsx`
- `src/components/segments/EstimateItemsTable.tsx`
- `src/components/segments/BarBreakdownTable.tsx`

---

## Phase 4: QA Center + Drawing Viewer + Outputs

### 4A. QA/Issues Center
Central issues queue from `validation_issues` table with filters by severity, status, segment, assignee

### 4B. Drawing Viewer Enhancement
Extend existing `BlueprintViewerPage` with:
- Right sidebar showing extracted items, confidence values
- Overlay markers for notes, dimensions, elements
- "Create issue" and "Link to segment" actions

### 4C. Outputs Center
Export management page listing available exports per project

### 4D. Standards Profiles Page
CRUD for `standards_profiles` table — admin screen

---

## Phase 5: Demo Data Seeding

Create a seed script that inserts realistic demo data:
- 2-3 sample projects with files
- Segments (footings, slabs, walls, columns)
- Estimate items and bar items
- Validation issues at various severities
- Draft drawing views

---

## Implementation Order

I recommend implementing **Phase 1** (DB migrations + routing + app shell) first, then **Phase 2** (dashboard + workspace tabs). This gives the structural foundation without breaking existing functionality.

### Total files impact estimate
- **Modified**: ~5 existing files (App.tsx, Dashboard.tsx, ProjectDashboard.tsx, WorkspaceLayout.tsx, index.css)
- **Created**: ~15-20 new component/page files
- **Migrations**: 1 migration with 7 new tables

Shall I proceed with Phase 1?

