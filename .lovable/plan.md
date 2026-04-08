

# Multi-File Upload + Structural & Architectural Analysis

## Problem
1. **FilesTab**: Upload button only accepts one file at a time (`e.target.files?.[0]`).
2. **Dashboard "New Estimation"**: Accepts `multiple` attribute but only reads `files[0]` for naming — doesn't upload any files to the created project.
3. No discipline tagging (structural vs architectural) on upload, so estimation only considers files generically.

## What Changes

### 1. FilesTab.tsx — Multi-file upload
- Add `multiple` attribute to the file input
- Loop over all selected files in `handleUpload`, uploading each sequentially
- Show progress count (e.g. "Uploading 2/5…")
- Call `loadFiles()` once after all uploads complete

### 2. Dashboard.tsx — Upload all files to new project on creation
After creating the project, before navigating:
- Loop through all selected files from the file input
- Upload each to `blueprints` storage and insert into `project_files`
- Then navigate to the project workspace

### 3. FilesTab.tsx — Add discipline badge on upload
- Detect discipline from filename patterns: files containing "S-", "STR", "structural" → "Structural"; "A-", "ARCH", "architectural" → "Architectural"; etc.
- Store as a `document_versions` record with `pdf_metadata.discipline` so the existing enrichment logic picks it up
- Display discipline badge in the files table (already wired)

### 4. Auto-estimation considers all disciplines
The existing `auto-estimate` and `auto-segments` edge functions already process all `project_files` for a project. By uploading both structural and architectural files and tagging their discipline, the AI analysis pipeline will see and process both sets. No edge function changes needed.

## Files Modified
- `src/components/workspace/FilesTab.tsx` — multi-file upload loop, discipline detection
- `src/pages/Dashboard.tsx` — upload all selected files to new project after creation

## No new files, no migrations, no edge function changes

