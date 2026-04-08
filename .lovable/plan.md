

# Fix Automatic Pipeline — Trigger Processing After Upload

## Problem
When a project is created and files uploaded from the Dashboard, the `process-pipeline` edge function is never called. It's only triggered from `ChatArea.tsx`. This leaves every new project stuck at **"intake" / L0 / Intake Pending**.

## What Changes

### 1. Dashboard.tsx — Trigger pipeline after file uploads
After the file upload loop (line 118), before navigating, call:
```typescript
await supabase.functions.invoke("process-pipeline", { body: { project_id: data.id } });
```
This kicks off the full pipeline (L0→L1→parsing→scope detection→workflow advancement).

### 2. FilesTab.tsx — Trigger pipeline after uploading new files
After the upload loop completes and `loadFiles()` is called, invoke the pipeline so that newly added files are processed and the project advances:
```typescript
await supabase.functions.invoke("process-pipeline", { body: { project_id: projectId } });
```

## Files Modified
- `src/pages/Dashboard.tsx` — add pipeline invoke after file uploads (1 line)
- `src/components/workspace/FilesTab.tsx` — add pipeline invoke after upload completes (1 line)

## No new files, no migrations, no edge function changes

