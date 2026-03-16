

# Fix: Scope Detection Fails for PDF Uploads

## Root Cause

The `detect-project-type` edge function receives signed URLs to the uploaded files. When those files are PDFs:

1. **Line 106**: PDFs over 4MB are **completely skipped** (`if (buf.byteLength > 4 * 1024 * 1024) continue`)
2. **Lines 116-124**: OCR (Google Vision) is only run for **image files**, never for PDFs
3. The user's two files are 6.05MB and 10.27MB -- **both exceed the 4MB limit**

Result