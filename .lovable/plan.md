# Per-File Parse Status — Idempotent Takeoff Generation

## Goal

Stop re-parsing/re-OCRing files that are already indexed. Show per-file status. Make "Generate Takeoff" safely re-runnable.

## Problem today

- TakeoffStage checks one project-wide row count (`indexedCount === 0`). If even one page is indexed, no parsing happens for the rest. If zero, every file re-runs from scratch on every click.
- No per-file feedback — user can't see which file succeeded, failed, or is missing.
- A re-click after partial failure either does nothing (count > 0) or re-OCRs everything (count = 0).

## Solution (minimum patch)

Add a `parse_status` column to `document_versions` and gate parsing per file.

### 1. Schema migration

Add 3 nullable columns to `document_versions`:

```text
parse_status   text     default 'pending'   -- pending | parsing | indexed | failed | scanned_failed
parse_error    text     nullable
parsed_at      timestamptz nullable
```

No data migration needed — existing rows default to `pending` and will be re-evaluated naturally (skipped if their pages already exist in `drawing_search_index`).

### 2. TakeoffStage.tsx changes

Replace the single `indexedCount` check with a per-file loop:

```text
for each file f:
  load document_versions row (or create)
  if parse_status == 'indexed'  -> skip, continue
  if parse_status == 'failed' && user is re-running -> retry
  set parse_status = 'parsing'
  try:
    extract-pdf-text
    if has text -> populate-search-index
    else        -> client render -> ocr-image -> populate-search-index
    set parse_status = 'indexed', parsed_at = now()
  catch e:
    set parse_status = 'failed', parse_error = e.message
```

Status pill in the UI uses `parse_status` directly.

### 3. FilesTab.tsx changes

Same status writes inside its existing parse helper (single source of truth — extract a tiny helper `runFileParse(fileRef)` shared by both stages so we don't duplicate logic).

### 4. Estimation gate

`auto-estimate` already reads from `drawing_search_index`. No change needed — it just gets more data when more files reach `indexed`.

## What this does NOT change

- Pipeline order stays the same: extract → (OCR fallback) → index → segment → estimate → validate.
- No change to edge functions.
- No change to RLS or auth flow.
- No queue/worker yet — keeps the in-tab orchestration. (We can add `analysis_jobs`-based async later as a separate phase.)

## Files touched

```text
supabase/migrations/<new>.sql              # +3 columns on document_versions
src/features/workflow-v2/stages/TakeoffStage.tsx   # per-file gate + status updates
src/components/workspace/FilesTab.tsx              # use shared helper, set status
src/lib/parse-file.ts  (new, ~80 lines)            # shared runFileParse() helper
```

## UX after the change

- Click "Generate Takeoff" twice in a row → second click skips already-indexed files instantly and only retries failed ones.
- Files tab shows a per-file badge: Pending / Parsing / Indexed / Failed.
- Failed files show the error on hover; user can click "Retry" on that single file without re-running everything.

## Out of scope (next phases)

- Page-classification step (cover/plan/detail/schedule) to skip irrelevant pages — phase 2.
- Move orchestration to `analysis_jobs` for tab-close resilience — phase 3.
- Bar-mark prefilter inside `auto-estimate` for token savings — phase 2.
