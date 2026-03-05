

## Plan: Client-Side PDF Rendering + Thin Edge Function

### Core Problem
`extract-pdf-text` crashes (546 WORKER_LIMIT) on large/scanned PDFs because `pdfjs-serverless` exceeds edge function resource limits. For scanned blueprints, text extraction returns empty anyway. The current architecture sends nothing useful to Gemini for these files.

### Key Constraint
All Supabase Edge Functions share the same ~150MB memory limit. Moving heavy work to a second edge function does not solve OOM. A Render/FastAPI worker cannot be provisioned from Lovable.

### Solution: Render PDF Pages in the Browser

The browser has ample memory and already has `pdfjs-dist` installed + `PdfRenderer.tsx`. The fix is to render scanned PDF pages to PNG images client-side, upload them to Storage, then send image URLs to `analyze-blueprint` (which already handles images via Vision OCR + Gemini).

```text
NEW FLOW:
  Browser renders PDF pages → PNG images → upload to Storage
  ↓
  Call analyze-blueprint with { imageUrls: [...page PNGs], pre_extracted_text: [...] }
  ↓
  analyze-blueprint: Vision OCR on images + Gemini stream → response
```

### Changes

**1. New utility: `src/lib/pdf-to-images.ts`**
- Function `renderPdfPagesToImages(pdfUrl, maxPages=10, scale=1.5)`
- Uses `pdfjs-dist` (already in browser) to render each page to canvas
- Converts canvas to PNG blob
- Uploads each page image to `blueprints` Storage bucket under `{projectId}/pages/`
- Returns array of signed URLs
- Sequential rendering (one page at a time) to stay within browser memory

**2. Update `ChatArea.tsx` → `streamAIResponse`**
- After calling `extract-pdf-text`, check if result shows `has_text_layer === false` or all pages are `is_scanned`
- For scanned PDFs: call `renderPdfPagesToImages()` to get page image URLs
- Add those image URLs to `fileUrls` sent to `analyze-blueprint` (they'll get Vision OCR + Gemini visual analysis)
- For text PDFs: keep current flow (send pre-extracted text)
- Show progress: "Rendering PDF pages for OCR analysis..."

**3. Update `extract-pdf-text/index.ts`**
- Reduce `MAX_PDF_SIZE` to **3MB** (only attempt pdfjs on small text-layer PDFs)
- For files >3MB: immediately return scanned-only response (no download, no pdfjs)
- This prevents all OOM crashes — large PDFs are handled client-side

**4. `analyze-blueprint/index.ts`** — no structural changes needed
- Already handles image URLs with Vision OCR + Gemini
- Already accepts `pre_extracted_text`
- The page images from step 2 flow through the existing image processing path

**5. `analysis_jobs` table** — already exists, no migration needed

### Safety
- Browser renders one page at a time (sequential, not parallel)
- Max 10 pages rendered to images (configurable)
- Scale 1.5x (not 2x) to reduce image size
- Each page PNG uploaded individually, canvas freed after each
- No PDF binary data ever enters an edge function for large files
- `extract-pdf-text` returns in <1s for large files (HEAD check only)

### Files to Create/Modify
1. **Create** `src/lib/pdf-to-images.ts` — browser-side PDF page renderer + Storage uploader
2. **Modify** `src/components/chat/ChatArea.tsx` — detect scanned PDFs, render pages client-side, pass image URLs
3. **Modify** `supabase/functions/extract-pdf-text/index.ts` — lower threshold to 3MB for instant scanned-only response

