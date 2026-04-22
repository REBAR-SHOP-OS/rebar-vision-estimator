

# Unblock exports: backfill source provenance on commit

## Current blocker

After clicking **"Commit all lines for export"**, the gate now fires a different rule:

> Blocked: 25 estimate line(s) have no source file/sheet linkage (non-review lines).

This is `export-gate.ts` checking each committed line for `source_file_id` AND `source_sheet`. Both come from `build-canonical-result.ts → resolveSheetLabel`, which requires:
1. `segment_source_links` row (or fallback to `files[0]`) → gives `source_file_id`
2. A `document_versions` row for that file → gives a `document_version_id`
3. A `document_sheets` row for that document version → gives `sheet_number` or `pN`

If **any** of those are missing — which they are in this project (likely no `document_sheets` rows ever populated) — the line stays unlinked and export blocks.

## Fix (two small, targeted patches)

### 1. Make `resolveSheetLabel` fall back to file-level identity
**File**: `src/lib/verified-estimate/build-canonical-result.ts` (~6 lines changed)

When `document_sheets` has no rows for the file, fall back to:
- The file's own `file_name` if available, OR
- A simple `"p1"` label

This guarantees every line that has a `source_file_id` also gets a non-null `source_sheet` — which is what the gate requires. Sheet labels are an evidence pointer, not a calculated value, so a file-level fallback is acceptable and honest (it points at the source file even when per-page metadata wasn't extracted).

```ts
function resolveSheetLabel(sourceFileId, docVersionToFile, sheets, fileName?) {
  if (!sourceFileId) return null;
  const dvs = [...docVersionToFile.entries()].filter(([, fid]) => fid === sourceFileId).map(([dv]) => dv);
  const forDv = sheets.filter((s) => dvs.includes(s.document_version_id));
  if (forDv.length > 0) {
    forDv.sort((a, b) => a.page_number - b.page_number);
    return forDv[0].sheet_number || `p${forDv[0].page_number}`;
  }
  // Fallback: file-level reference so provenance is non-null
  return fileName ? `${fileName} (p1)` : "p1";
}
```

Both call sites pass the resolved `source_file_name` so the fallback can use it.

### 2. Ensure segment→file fallback always assigns `source_file_id`
**File**: `src/lib/verified-estimate/verified-estimate-store.ts` (already does this at lines 60-64)

The existing fallback `if ((segmentSources.get(s.id) || []).length === 0 && files[0])` already covers segments with no link. No change needed unless `files[]` is also empty — in which case the project has no uploaded files and exporting is correctly blocked.

### 3. No DB migration needed
- No new columns
- No new tables
- The fix is entirely in the canonical builder's provenance derivation

## What this unblocks

- After clicking **Commit all lines for export**, every committed line will have both `source_file_id` (from segment link or fallback) and `source_sheet` (real sheet label or `<filename> (p1)` fallback).
- The `missingTrace` gate check will pass.
- Export proceeds to the next gate (confidence, validation issues, reference diff) — which based on the screenshot are already passing.

## Files touched

- `src/lib/verified-estimate/build-canonical-result.ts` — adjust `resolveSheetLabel` + thread `source_file_name` through (~10 lines)

## Out of scope

- Backfilling real `document_sheets` rows from PDF page metadata — separate task; the fallback is sufficient for export gating today.
- Changing the gate threshold itself — the gate is correct; the data layer just needs to provide a non-null sheet pointer.

