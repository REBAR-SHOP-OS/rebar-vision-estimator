

# Comprehensive Audit & Remediation Plan

## Audit Summary

### What Works (Verified)
- **Database**: All 9 tables exist with RLS (`segments`, `estimate_items`, `bar_items`, `validation_issues`, `drawing_views`, `standards_profiles`, `approvals`, `segment_source_links`, `audit_events`). `source_file_id` columns confirmed on `estimate_items` and `validation_issues`.
- **Routing**: Full nested route structure under `/app` with `AppShell`.
- **SourcesPanel**: Real CRUD via `segment_source_links` with audit logging + unlink.
- **QATab**: Issue creation, edit, status transitions, resolution notes required, audit logging.
- **ApprovalPanel**: Create/approve/reject with blocker gating + audit logging.
- **OutputsTab**: Real CSV/HTML export handlers with approval-gate banners.
- **DrawingViewsPanel**: Read + "Generate Draft" creates records.
- **StandardsPage**: Full CRUD with cover/lap/hook defaults, naming rules JSON, delete, set default.
- **FilesTab**: Enriched table with segment counts from `segment_source_links` and issue counts from `source_file_id`.
- **Audit logging**: `logAuditEvent` utility integrated across panels.

### Gaps Found

| # | Gap | Severity | Location |
|---|-----|----------|----------|
| 1 | **Settings tab is a placeholder** — just says "coming soon" | Medium | `ProjectWorkspace.tsx:100` |
| 2 | **No project edit UI** — can't update name, client, address, type, description after creation | Medium | Missing |
| 3 | **No file upload from Files tab** — files only uploadable from Dashboard file input | Medium | `FilesTab.tsx` |
| 4 | **Segment detail Issues tab is read-only** — no create/edit inline, unlike the project QA tab | Medium | `SegmentDetail.tsx:206-232` |
| 5 | **No estimate item inline editing** — estimate items table is display-only | Low | `SegmentDetail.tsx:131-160` |
| 6 | **No bar item creation/editing** — bar schedule is display-only | Low | `SegmentDetail.tsx:163-199` |
| 7 | **DrawingViewsPanel "Generate Draft" only inserts a DB record** — doesn't call the shop drawing edge function | Low | `DrawingViewsPanel.tsx:39-47` |
| 8 | **Standards default race condition** — two separate UPDATE calls (clear all, then set one) | Low | `StandardsPage.tsx:120-129` |
| 9 | **SegmentDetail doesn't pass `projectId` to DrawingViewsPanel** — audit event has no project context | Trivial | `SegmentDetail.tsx:203` |
| 10 | **Segment edit/delete** — no way to rename, change type, or delete segments | Low | `SegmentsTab.tsx` |
| 11 | **Dashboard doesn't show file counts or issue summaries per project** | Low | `ProjectDashboard.tsx` |

---

## Remediation Plan (Minimal Patches)

### 1. Build Settings Tab (fills the placeholder)
**File**: Create `src/components/workspace/ProjectSettingsTab.tsx`

Editable fields from `projects` table:
- `name`, `client_name`, `address`, `project_type`, `description`, `status`, `workflow_status`
- Delete project action (with confirmation)

**File**: `ProjectWorkspace.tsx` — import and render `ProjectSettingsTab` in the settings `TabsContent` instead of the placeholder text.

### 2. Add File Upload to Files Tab
**File**: `FilesTab.tsx`

Add an "Upload File" button that:
- Opens a file picker
- Uploads to Supabase storage (`project-files` bucket)
- Inserts a `project_files` row
- Logs audit event
- Refreshes the file list

### 3. Wire Segment-Scoped Issue Create/Edit
**File**: `SegmentDetail.tsx`

Replace the read-only issues list with a reuse of the `QATab` component, passing `segmentId` as an additional filter prop.

**File**: `QATab.tsx` — add optional `segmentId` prop. When present, filter by `segment_id` and pass it on insert.

### 4. Add Estimate Item Inline Editing
**File**: `SegmentDetail.tsx`

Add an edit dialog for estimate items (description, bar_size, quantity_count, total_length, total_weight, status). Log audit events on save.

### 5. Add Segment Edit/Delete
**File**: `SegmentsTab.tsx`

Add edit dialog (name, type, level_label, zone_label, notes) and delete action with confirmation. Log audit events.

### 6. Fix Standards Default Race Condition
**File**: `StandardsPage.tsx:116-130`

Replace two-step update with a single RPC or use `.neq("id", id)` to clear others atomically:
```
await supabase.from("standards_profiles").update({ is_default: false }).neq("id", id);
await supabase.from("standards_profiles").update({ is_default: true }).eq("id", id);
```

### 7. Pass projectId to DrawingViewsPanel
**File**: `SegmentDetail.tsx:203`

Add `projectId` prop to `DrawingViewsPanel`.

**File**: `DrawingViewsPanel.tsx` — accept optional `projectId`, pass to `logAuditEvent`.

### 8. Add QA segmentId Support
**File**: `QATab.tsx`

Add optional `segmentId?: string` prop. When set, add `.eq("segment_id", segmentId)` to queries and include `segment_id` in insert payload.

---

## Files Modified (8)
- `src/pages/ProjectWorkspace.tsx` — import ProjectSettingsTab
- `src/components/workspace/FilesTab.tsx` — add upload button
- `src/components/workspace/QATab.tsx` — add segmentId prop
- `src/components/workspace/DrawingViewsPanel.tsx` — add projectId prop
- `src/pages/SegmentDetail.tsx` — use QATab for issues, add estimate edit, pass projectId
- `src/components/workspace/SegmentsTab.tsx` — add edit/delete
- `src/pages/StandardsPage.tsx` — fix race condition (2-line patch)

## Files Created (1)
- `src/components/workspace/ProjectSettingsTab.tsx` — project settings form

## No Migrations Needed
All referenced columns already exist in the database.

