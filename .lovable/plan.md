

## Fix: PDF Size Limit Blocking All Blueprint Analysis

### Root Cause
The `analyze-blueprint` edge function has `MAX_PDF_SIZE_MB = 4` and `MAX_PDF_COUNT = 2`. Real-world structural/architectural PDFs are typically 10-30 MB, so they ALL get skipped. The AI then has nothing to analyze and returns zero results.

### The Problem Chain
1. User uploads 20MB + 16MB PDFs
2. Function downloads each, checks size → both exceed 4MB → skipped
3. `fileContentParts` array is empty
4. AI receives only chat messages, no drawings
5. AI correctly reports "no blueprints provided"

### Solution: Multi-Page PDF Rendering to Images

Instead of sending the entire PDF as base64 (which hits Gemini's limits), render individual PDF pages as images and send those. This is the standard approach for large engineering PDFs.

**Changes to `supabase/functions/analyze-blueprint/index.ts`:**

1. **Increase `MAX_PDF_SIZE_MB` from 4 to 25** — allow real-world PDFs to be downloaded
2. **Add page-level rendering**: Use `pdfjs-serverless` (already imported) to render each page as a canvas/image instead of sending the entire PDF as one base64 blob
3. **Limit pages**: Process first 10-15 pages per PDF (configurable) to stay within token limits
4. **Keep PDF-native text extraction**: This already works and extracts text layers — it just needs the PDF to not be skipped

**Specific code changes:**

- Line 1322: `MAX_PDF_SIZE_MB = 4` → `MAX_PDF_SIZE_MB = 25`
- Lines 1350-1365: Instead of converting entire PDF to one base64 `application/pdf`, iterate pages with `getDocument()` (already imported), render each page to a PNG image, and push individual page images to `fileContentParts`
- Add a `MAX_PAGES_PER_PDF = 15` constant to limit pages processed
- The PDF-native text extraction (lines 1367-1394) continues working as-is since it already processes the buffer before the size skip

### Also Fix: extract-pdf-text Edge Function Failure
The `extract-pdf-text` calls from the client both failed with "Failed to fetch". This is a separate function that pre-extracts text. Need to check if it's deployed and working, but the primary fix is in `analyze-blueprint` which does its own PDF extraction internally.

### Impact
- Real PDFs (10-30MB) will actually be processed
- Each page rendered as ~200-500KB PNG → well within Gemini limits
- PDF text layers still extracted for high-accuracy data
- Master Prompt and Dual-Analysis will finally receive actual blueprint content to work with

