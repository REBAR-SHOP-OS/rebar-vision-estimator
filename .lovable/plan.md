

# Fix Files Not Being Saved — Two Issues

## Problem
1. **Storage uploads fail silently on project creation**: The Dashboard upload loop uses `console.warn` when storage upload fails, so files never get inserted into `project_files`. The two most recent projects in the database have 0 files despite being created with file selection.
2. **Empty state has no upload button**: When the Files tab shows "No files uploaded yet", there is no upload button visible — the upload button only appears in the header when files already exist (line 167+). Users are stuck.

## Changes

### 1. FilesTab.tsx — Add upload button to empty state
In the empty state block (lines 143-151), add an upload button with the same file input logic so users can upload files even when no files exist yet.

### 2. Dashboard.tsx — Add error feedback on upload failure
Replace `console.warn("Upload failed:", file.name)` with `toast.error(...)` so users see when uploads fail. Also add a toast showing how many files succeeded vs failed.

### 3. Dashboard.tsx — Add storage error details to help debug
Log the actual `storageErr` object so the root cause of upload failures is visible in the console.

## Files Modified
- `src/components/workspace/FilesTab.tsx` — add upload button to empty state
- `src/pages/Dashboard.tsx` — improve error feedback on file upload failures

## No new files, no migrations, no edge function changes

