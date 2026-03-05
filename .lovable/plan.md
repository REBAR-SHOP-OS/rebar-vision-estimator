

## ✅ DONE: PDF Size Limit Fix + Page-by-Page Processing

### Changes Made to `supabase/functions/analyze-blueprint/index.ts`
1. `MAX_PDF_SIZE_MB`: 4 → 25 (allows real-world engineering PDFs)
2. Added `MAX_PDF_INLINE_MB = 15` — PDFs under 15MB sent as base64 to Gemini Vision; larger ones use text extraction only
3. Added `MAX_PDF_COUNT = 3` (was 2)
4. Added `MAX_PAGES_PER_PDF = 15` — limits text extraction to first 15 pages
5. Text extraction now runs BEFORE size check (always extracts text for any downloaded PDF)
6. Added `extractTitleBlockMeta()` function — regex-based sheet/discipline/scale/revision detection
7. Title block metadata included in text extraction output for each page
8. PDFs 15-25MB: text extracted + title blocks parsed, but NOT sent as base64 (too large for Gemini inline)
9. PDFs <15MB: full treatment (text extraction + base64 visual analysis)

