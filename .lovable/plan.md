

# Audit Remediation — Fill Remaining Genuine Gaps

## Audit Cross-Reference

Many findings in the audit are stale (written against an earlier snapshot). Here is what is **already implemented** and what **genuinely remains**:

### Already Working (No Action Needed)
- Source traceability via `segment_source_links` table with link/unlink + audit logging
- Issue creation, edit, resolution note requirement, reopen handling
- Audit event logging across all panels (QA, Approvals, Sources, Settings, Files, Standards)
- File upload from Files tab with storage + audit
- Segment CRUD (create, edit, delete with confirmation)
- Project settings tab (name, client, type, address, status, workflow, delete)
- Real export handlers (CSV for issues/estimates/quotes, HTML viewer for shop drawings)
- Approval blocker gating (blocks approve when critical/error issues exist)
- QA segmentId filtering
- DrawingViewsPanel generates draft DB records
- Standards profile default selection with audit logging

### Genuinely Missing (To Fix Now)

| # | Gap | File | Effort |
|---|-----|------|--------|
| 1 | Estimate item inline edit dialog | SegmentDetail.tsx | Medium |
| 2 | Bar item add/edit dialog | SegmentDetail.tsx | Medium |
| 3 | Source file "View" button is a no-op | SourcesPanel.tsx | Small |
| 4 | DrawingViewsPanel doesn't call shop-drawing edge function | DrawingViewsPanel.tsx | Small |
| 5 | Estimate item source_file_id linking UI | SegmentDetail.tsx | Small |
| 6 | FilesTab "View file" action missing | FilesTab.tsx | Small |
| 7 | Segment create missing audit log | SegmentsTab.tsx | Trivial |

---

## Implementation Plan

### 1. Estimate Item Inline Edit Dialog (SegmentDetail.tsx)
Add an edit dialog triggered by clicking a table row. Editable fields: `description`, `bar_size`, `quantity_count`, `total_length`, `total_weight`, `status`, `source_file_id`. Uses existing `supabase.from("estimate_items").update()`. Logs audit event on save.

### 2. Bar Item Add/Edit Dialog (SegmentDetail.tsx)
Add "Add Bar" button and row-click edit dialog. Fields: `mark`, `size`, `shape_code`, `cut_length`, `quantity`, `finish_type`, `cover_value`, `lap_length`. Insert/update via `bar_items` table. Logs audit event.

### 3. Source File View Button (SourcesPanel.tsx)
Wire the existing `ExternalLink` button to fetch a signed URL from Supabase storage and open in new tab:
```typescript
const { data } = await supabase.storage.from("blueprints").createSignedUrl(filePath, 3600);
window.open(data?.signedUrl, "_blank");
```
Requires joining `project_files.file_path` into the source link data.

### 4. DrawingViewsPanel — Call Edge Function (DrawingViewsPanel.tsx)
Change "Generate Draft" to invoke the `generate-shop-drawing` edge function with segment data, then store the returned HTML in `shop_drawings` table and update the `drawing_views` record status to "review".

### 5. Estimate Item Source File Linking (SegmentDetail.tsx)
Add a `source_file_id` selector (dropdown of project files) in the estimate item edit dialog. Shows linked file name in the table.

### 6. Files Tab View Action (FilesTab.tsx)
Add a "View" button per file row that fetches a signed URL and opens the file in a new tab.

### 7. Segment Create Audit Log (SegmentsTab.tsx)
Add `logAuditEvent` call after successful segment creation (currently missing, edit/delete already have it).

---

## Files Modified (4)
- `src/pages/SegmentDetail.tsx` — add estimate item edit dialog, bar item add/edit dialog, source_file_id linking
- `src/components/workspace/SourcesPanel.tsx` — wire view button with signed URL
- `src/components/workspace/DrawingViewsPanel.tsx` — call edge function on generate
- `src/components/workspace/FilesTab.tsx` — add view file action
- `src/components/workspace/SegmentsTab.tsx` — add audit log on create

## Files Created
None.

## Migrations
None needed — all referenced columns already exist.

