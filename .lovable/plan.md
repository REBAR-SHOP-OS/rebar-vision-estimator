

# Fix: Extract Real Segments from Large PDFs

## Problem

The auto-detected segments show generic names ("Footings", "Slabs", "Walls") with "Inferred from structural drawing file name" because **zero drawing text was extracted**. The `drawing_search_index` table has 0 rows for this project.

**Root cause**: Both PDFs are large (21.5 MB and 16.9 MB). The `extract-pdf-text` edge function has a 3 MB hard limit and returns empty `raw_text` pages for anything larger. With no text, `populate-search-index` indexes nothing, and `auto-segments` falls back to guessing from file names.

```text
Current flow (broken for large files):
  21MB PDF → extract-pdf-text → "file_too_large" → empty pages → no search index → generic segments

Required flow:
  21MB PDF → client-side page rendering → OCR per page → search index populated → real segments
```

## Fix

### 1. `src/components/workspace/FilesTab.tsx` — Client-side large-file fallback

When `extract-pdf-text` returns `skipped_reason: "file_too_large"` or all pages have empty `raw_text`, fall back to a client-side pipeline:

1. Use the existing `renderPdfPagesToImages()` to render pages to PNG (already works for any size)
2. For each page image, call the existing `ocr-image` edge function (Google Vision API) to get text
3. Run `extractTitleBlock()` locally on the OCR text to get sheet numbers and disciplines
4. Pass the assembled pages array to `populate-search-index` as normal

This reuses two existing systems (`pdf-to-images` + `ocr-image`) — no new edge functions needed.

### 2. `src/components/workspace/FilesTab.tsx` — Progress feedback for OCR

Update progress messages: "OCR page 1/41...", "OCR page 2/41..." so the user sees the flow is active during the longer OCR process.

### 3. Auto-segments will work automatically

Once `drawing_search_index` has real text, the existing `auto-segments` function will find actual elements (F1-F8, P1-P8, W1-W8, Step on Grade, SOG with WWM) instead of generic guesses. No changes needed to auto-segments.

## Technical Details

- `renderPdfPagesToImages` renders sequentially (memory-safe), uploads PNGs to storage
- `ocr-image` accepts a signed URL and returns text via Google Vision API
- Process pages in batches of 4 (parallel) to balance speed vs. rate limits
- Cap at first 50 pages to stay within reasonable processing time
- Store OCR text in the same `pages` format that `populate-search-index` expects

## Files Modified
- `src/components/workspace/FilesTab.tsx` — add large-file OCR fallback in `parseFile`, update progress labels

