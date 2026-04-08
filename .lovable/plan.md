

# Enhance Provenance with Full Address + Clickable Drawing Navigation

## What Changes

### 1. `src/pages/SegmentDetail.tsx` — Fetch additional context for provenance

In `loadData()`, add a query to fetch `drawing_search_index` entries for this project to get page numbers per source file. Also fetch `document_versions` for page metadata.

Use this data to enrich the provenance line:
- **Page number**: from `drawing_search_index.page_number` matched via `source_file_id` → `document_version_id`
- **Segment address**: show `segment.level_label`, `zone_label`, `segment_type`
- **Full file name**: already available from `projectFiles`

Display format per bar line:
```
A1  [15M]  72 × (6,000 mm ÷ 1000) × 1.570 kg/m = 678.2 kg
📍 Source: Continuous Wall Footing - Longitudinal Reinforcement
   Drawing: CRU-1 Structral (4).pdf · Page 3 · Segment: L1 / Zone A / Foundation
   Confidence: 90% · AI-generated
```

### 2. `src/pages/SegmentDetail.tsx` — Make drawing reference clickable

Add a click handler on the drawing/page reference that:
1. Fetches a signed URL for the source file from storage
2. Sets `sessionStorage` with `blueprint-viewer-data` including the page number and any overlay elements for this segment
3. Opens `/blueprint-viewer` in a new tab via `window.open`

The blueprint viewer already supports PDF page navigation (`currentPage`) and element highlighting via `selectedElementId`, so passing the correct page number and element data will auto-navigate and highlight.

### 3. Data joining approach

- Match `estimate_item.source_file_id` → `project_files.id` for file name
- Match `estimate_item.source_file_id` → `document_versions.file_id` → get `page_count` and `pdf_metadata`
- Match `source_file_id` → `drawing_search_index` entries (via `document_version_id`) to find relevant page numbers
- Use segment's `level_label`, `zone_label`, `segment_type` for the address

## Files Modified
- `src/pages/SegmentDetail.tsx` — add drawing_search_index + document_versions queries, enrich provenance display, add click-to-open handler

## No new files, no migrations, no edge function changes

