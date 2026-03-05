

## Plan: Refactor `analyze-blueprint` to Thin Job Router Pattern

### Problem
The `analyze-blueprint` edge function (1,678 lines) downloads PDFs, runs pdfjs text extraction, runs Google Vision OCR, builds a massive prompt, and calls Gemini — all in a single request. This consistently exceeds the ~150MB memory / ~60s CPU limit of Supabase Edge Functions for real-world engineering PDFs.

### Architecture Change

```text
BEFORE (monolith):
  Client → Edge Function (download PDF + OCR + pdfjs + Gemini stream) → Client

AFTER (job router):
  Client → upload to Storage → Edge Function (validate + create job row → 202) → Client polls
                                        ↓
                              Edge Function "run-analysis" (triggered by client poll or direct call)
                              reads from Storage, does OCR + Gemini, writes result to DB
```

However, there is a fundamental constraint: **Supabase Edge Functions all share the same memory limits**. Moving heavy work to a second edge function does not solve the OOM. The user's suggestion of a Render worker (Option A) requires external infrastructure we cannot provision here.

**Practical approach that works within Lovable Cloud:**

1. **Split the work across multiple sequential edge function calls** from the client, each doing one bounded task:
   - Call 1: `extract-pdf-text` (already exists) — extracts text from ONE PDF at a time
   - Call 2: `analyze-blueprint` — receives only text/metadata (no PDF bytes), calls Gemini

2. **The edge function becomes a thin router** that never touches PDF bytes:
   - Accepts `storage_paths` instead of file URLs
   - Client pre-extracts text via `extract-pdf-text` for each PDF sequentially
   - `analyze-blueprint` receives extracted text + image URLs only (small payload)

### Database Migration

Create `analysis_jobs` table for async job tracking:

```sql
CREATE TABLE public.analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid,
  storage_paths text[] DEFAULT '{}',
  signed_urls text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed')),
  error text,
  result jsonb,
  request_payload jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own jobs"
  ON public.analysis_jobs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### Edge Function Changes (`analyze-blueprint/index.ts`)

**Strip out entirely:**
- `pdfjs-serverless` import and `extractPdfText` function (~90 lines)
- PDF download/base64/inline logic (~180 lines)
- Google Vision OCR functions stay (they handle small images, not OOM cause)

**New flow:**
1. Validate input — reject payloads > 50KB, require `storage_paths` or `pre_extracted_text`
2. Create `analysis_jobs` row with status `running`
3. Process only images (small, safe) — no PDF bytes in memory
4. Accept `pre_extracted_text` (client sends text already extracted by `extract-pdf-text`)
5. Build Gemini prompt from text + image URLs only
6. Stream response back, update job to `done` on completion
7. On error, update job to `failed`

### Frontend Changes (`ChatArea.tsx`)

Update `streamAIResponse` to:

1. **Pre-extract PDF text client-side** — for each PDF URL, call `extract-pdf-text` edge function sequentially (it already exists and handles one PDF at a time safely)
2. **Send extracted text** to `analyze-blueprint` instead of raw PDF URLs
3. **Create job record** and poll `analysis_jobs` for status if using async mode
4. Keep SSE streaming for the Gemini response (no change to UX)

The key payload change:
```typescript
// BEFORE: sends raw PDF URLs for edge function to download
body: { fileUrls: [pdfUrl1, pdfUrl2], messages, ... }

// AFTER: pre-extract text, send only text + image URLs
const extracted = [];
for (const url of pdfUrls) {
  const res = await supabase.functions.invoke('extract-pdf-text', { body: { pdf_url: url } });
  extracted.push(res.data);
}
body: { 
  pre_extracted_text: extracted,  // text only, no binary
  imageUrls: [imgUrl1],          // small images only
  messages, ...
}
```

### Files to Create/Modify

1. **SQL Migration** — create `analysis_jobs` table with RLS
2. **`supabase/functions/analyze-blueprint/index.ts`** — remove all PDF download/pdfjs code, accept `pre_extracted_text` parameter, add 50KB payload guard, add job status tracking
3. **`src/components/chat/ChatArea.tsx`** — pre-extract PDF text via `extract-pdf-text` calls before calling `analyze-blueprint`, separate PDF URLs from image URLs

### Safety Limits
- Reject request body > 50KB (after removing PDF bytes, payloads will be ~5-20KB of text)
- No `Promise.all` over pages inside edge function
- No PDF `ArrayBuffer` in memory at any point in `analyze-blueprint`
- Sequential extraction calls from client (one PDF at a time)

