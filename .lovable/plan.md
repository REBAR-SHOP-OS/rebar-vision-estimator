

# Fix: Auto-Trigger Parsing After File Upload

## Problem
After uploading files, the workflow stops at "files uploaded" (green) and "parsing" stays gray. The `process-pipeline` edge function only **checks** database state — it never **triggers** parsing. Users must manually click "Parse All" on the Files tab, which is not discoverable.

## Root Cause
```text
Current flow:
  Upload file → insert project_file → insert document_version (no page_count) → call process-pipeline
  process-pipeline checks: document_versions with page_count? NO → stays at files_uploaded

Missing step:
  Nobody calls extract-pdf-text + populate-search-index automatically
```

## Fix

### 1. `src/components/workspace/FilesTab.tsx` — Auto-parse after upload

After the file upload loop (line 88), instead of just calling `process-pipeline`, also run the same parsing logic that `handleParseAll` uses — for each newly uploaded file:
- Get signed URL
- Call `extract-pdf-text`
- Call `populate-search-index`  
- Update `document_versions` with `page_count`
- Then call `process-pipeline` (which will now see parsed files and advance to "parsing" or beyond)

Extract the per-file parse logic from `handleParseAll` (lines 111-181) into a shared helper function (`parseFile`) to avoid duplication. Call it for each file during upload.

### 2. `src/components/workspace/FilesTab.tsx` — Upload progress feedback

Update `uploadProgress` state to show parsing status: "Uploading 1/3...", then "Parsing 1/3...", so the user sees the flow is active.

### 3. No edge function changes

The existing `extract-pdf-text` and `populate-search-index` functions work correctly. The issue is purely that they aren't called after upload.

## Files Modified
- `src/components/workspace/FilesTab.tsx` — extract parse helper, call it after upload, update progress messages

