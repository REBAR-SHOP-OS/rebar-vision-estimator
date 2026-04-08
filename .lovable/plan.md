

# Audit Remediation Plan — From Demo Shell to Trustworthy Workspace

## Verified Current State

**What exists and works:**
- All 7 tables exist via migration (segments, estimate_items, bar_items, validation_issues, drawing_views, standards_profiles, approvals) with RLS policies
- Routing structure: `/app`, `/app/project/:id`, `/app/project/:id/segments/:segId`, `/app/standards`
- UI shells for: SegmentDetail (6 tabs), QATab (edit dialog), FilesTab (enriched list), ApprovalPanel, SourcesPanel, DrawingViewsPanel, OutputsTab, StandardsPage, ProjectOverview

**What the audit correctly identifies as missing or weak:**
Every finding in the audit is valid. The codebase has UI shells reading/writing data, but lacks workflow integrity, traceability model, export logic, event logging, and server-side enforcement.

---

## Prioritized Fix Plan (ordered by production risk)

### Phase A: Data Model Fixes (Migration)

**1. Create `segment_source_links` table** — replaces the fragile estimate_items hack

```sql
CREATE TABLE public.segment_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  file_id uuid NOT NULL,
  user_id uuid NOT NULL,
  linked_at timestamptz DEFAULT now(),
  UNIQUE(segment_id, file_id)
);
-- RLS: auth.uid() = user_id
```

**2. Create `audit_events` table** — durable event log

```sql
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid,
  segment_id uuid,
  entity_type text NOT NULL,  -- 'approval','issue','source_link','export','standards_profile'
  entity_id uuid,
  action text NOT NULL,       -- 'created','approved','rejected','resolved','linked','unlinked','exported','set_default'
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
-- RLS: auth.uid() = user_id (insert + select only)
```

**3. Add `source_file_id` column to `estimate_items`** — direct traceability per line item

```sql
ALTER TABLE public.estimate_items ADD COLUMN source_file_id uuid;
```

**4. Add `source_file_id` column to `validation_issues`** — direct traceability per issue

```sql
ALTER TABLE public.validation_issues ADD COLUMN source_file_id uuid;
```

---

### Phase B: Source Traceability (Replace Placeholder Hack)

**Files: `SourcesPanel.tsx`**
- Rewrite to use `segment_source_links` table instead of estimate_items assumptions_json hack
- Add unlink action (delete from segment_source_links)
- Log `audit_events` on link/unlink

**Files: `FilesTab.tsx`**
- Replace segment count inference (from estimate_items assumptions_json) with direct count from `segment_source_links`
- Replace issue count proxy (sheet_id) with `validation_issues.source_file_id`

---

### Phase C: QA Issue Workflow Hardening

**Files: `QATab.tsx`**
- Add issue creation dialog (currently only edit exists)
- Add `source_file_id` selector when creating/editing issues
- Require `resolution_note` when changing status to "resolved"
- Log `audit_events` on status change
- Add reopened issue handling (resolved → open)

**Files: `SegmentDetail.tsx` issues tab**
- Wire the same create/edit flow for segment-scoped issues

---

### Phase D: Approval Workflow Integrity

**Files: `ApprovalPanel.tsx`**
- Log `audit_events` on create/approve/reject
- Add validation: prevent approve when blockers exist (currently only blocks new request creation, not resolution)
- Add `resolved_at` timestamp display

**Files: `OutputsTab.tsx`**
- Gate export buttons server-side concept: check latest approval status before enabling
- Currently buttons do nothing — add real export handlers:
  - Estimate summary → call existing PDF export (`pdf-export.ts`)
  - Shop drawings → link to existing `shop_drawings` table HTML
  - Issues report → generate CSV from `validation_issues`
  - Quote package → link to existing `quote_versions`
- Log `audit_events` on export

**Clarify approval model:**
- Project-level approvals gate outputs (OutputsTab checks project-level)
- Segment-level approvals are informational per-segment review
- Document this in code comments

---

### Phase E: Standards Profile Fixes

**Files: `StandardsPage.tsx`**
- Fix race condition on "set default": use a single UPDATE + transaction approach instead of clear-all-then-set
- Add naming rules editor (currently JSON field exists but no UI)
- Add delete profile action

---

### Phase F: Drawing Views + Segment Detail Improvements

**Files: `DrawingViewsPanel.tsx`**
- Add "Generate Draft" action button (calls existing `generate-shop-drawing` edge function)
- Add link back to source segment info

**Files: `SegmentDetail.tsx`**
- Add inline editing for estimate items (description, qty, bar_size, manual override)
- Add "Show Source" button per estimate item (opens linked file)

---

### Phase G: Event Logging Utility

**Create: `src/lib/audit-logger.ts`**
- Helper function: `logAuditEvent(user_id, project_id, entity_type, entity_id, action, metadata)`
- Used by all panels that write data

---

## Files Modified
- `src/components/workspace/SourcesPanel.tsx` — rewrite for segment_source_links
- `src/components/workspace/FilesTab.tsx` — fix count sources
- `src/components/workspace/QATab.tsx` — add create, require resolution note, audit events
- `src/components/workspace/ApprovalPanel.tsx` — add audit events, prevent approve with blockers
- `src/components/workspace/OutputsTab.tsx` — add real export handlers
- `src/components/workspace/DrawingViewsPanel.tsx` — add generate action
- `src/pages/SegmentDetail.tsx` — add estimate item editing, source linking
- `src/pages/StandardsPage.tsx` — fix default race, add naming rules, delete

## Files Created
- `src/lib/audit-logger.ts` — audit event helper

## Migration
- 1 migration: create `segment_source_links`, `audit_events`, add `source_file_id` to estimate_items and validation_issues

## What This Does NOT Include (Future Phases)
- Role-based permission system (requires `user_roles` table + security definer functions)
- Server-side edge function gating for exports (requires new edge function)
- Full drawing viewer with overlays
- Unit/integration tests
- Revision lineage/supersession logic for files

These are called out explicitly so nothing is overstated.

