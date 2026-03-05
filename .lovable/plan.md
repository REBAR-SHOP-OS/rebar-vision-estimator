

## Plan: Fix PDF Processing — Blueprint PDFs Silently Dropped

### Root Cause
The previous OOM fix (reducing `MAX_PDF_INLINE_MB` to 4 and `MAX_INLINE_PDF_COUNT` to 1) was too aggressive. For a project with two engineering PDFs (Architectural + Structural), both likely exceed 4MB, meaning:
- Neither is sent as base64 inline to Gemini
- If both exceed 5MB, text extraction is also skipped
- The AI only sees the knowledge image (RSIC reference card) — hence "no blueprints found"

### Fix Strategy
Avoid simultaneous memory-heavy operations. Process PDFs sequentially with a smarter strategy:

1. **Increase `MAX_PDF_INLINE_MB` from 4 → 8MB** — allow medium PDFs to be sent to Gemini
2. **Increase `MAX_INLINE_PDF_COUNT` from 1 → 2** — both blueprint PDFs should be visible
3. **Skip pdfjs text extraction when sending inline** — avoid running BOTH base64 encoding AND pdfjs on the same PDF (this was the OOM cause)
4. **Increase `MAX_PDF_TEXT_EXTRACT_MB` from 5 → 10MB** — for PDFs too large for inline, at least extract text
5. **Free memory between PDFs** — null out buffers after processing each PDF

The logic becomes:
- PDF ≤ 8MB → send as base64 inline to Gemini (skip pdfjs to save memory)
- PDF 8-10MB → run pdfjs text extraction only (no inline)
- PDF 10-25MB → download but only log metadata (too large for edge function)

### File to modify
- **`supabase/functions/analyze-blueprint/index.ts`** — adjust constants and reorder the inline-vs-extraction logic to be mutually exclusive per PDF

