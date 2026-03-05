

## PDF-Native Extraction + Pipeline CRM Integration

### Context

The current system sends raw PDF bytes as base64 to Gemini and runs Google Vision OCR on images only. PDFs are treated as opaque blobs -- no text, vector paths, or table structures are extracted before sending to the AI. This means the AI must "read" the PDF visually, which loses precision on dimensions, quantities, and table data.

The Excel ground truth (20 York Valley) shows **153 distinct bar lines** across 7 element groups totaling **44,777 kg**. The AI needs to see all of this data accurately.

### What Changes

#### Part 1: PDF-Native Text Extraction Edge Function

**New file**: `supabase/functions/extract-pdf-text/index.ts`

A new edge function that uses `pdfjs-serverless` (a zero-dependency, Deno-compatible build of PDF.js) to extract structured text from machine-generated PDFs before they reach the AI.

- Import `getDocument` from `pdfjs-serverless` via `esm.sh`
- For each PDF page: extract all text items with position (x, y), font size, and text content
- Group text items into logical rows by Y-coordinate proximity (within 3pt threshold)
- Sort rows top-to-bottom, items left-to-right within each row
- Detect table structures: when 3+ consecutive rows have similar column alignment, mark as table
- Output per-page: `{ page_number, raw_text, tables[], text_blocks[], is_scanned: boolean }`
- If a page yields zero or near-zero text items, flag `is_scanned: true` for OCR fallback
- Return SHA-256 hash of PDF content for deduplication

#### Part 2: Integrate PDF Text into analyze-blueprint

**File**: `supabase/functions/analyze-blueprint/index.ts`

Before sending PDFs to Gemini, call the new `extract-pdf-text` function internally:

- For each PDF URL: fetch the PDF, call `pdfjs-serverless` inline (no separate function call needed -- embed the extraction logic directly in analyze-blueprint to avoid an extra network hop)
- Inject the extracted text as a structured section in the user message: `## PDF-NATIVE TEXT EXTRACTION (HIGH ACCURACY)\n{structured text with tables}`
- Add a prompt instruction: "PDF-native text extraction is provided below. This text is DIRECTLY parsed from the PDF vector layer and is MORE ACCURATE than OCR. Use it as your PRIMARY data source for dimensions, bar sizes, quantities, and schedule tables. Only use OCR/visual analysis to supplement missing information."
- For scanned pages: continue using Google Vision OCR as before
- Keep existing image-based Vision OCR for non-PDF files unchanged

#### Part 3: Pipeline CRM Integration Edge Function

**New file**: `supabase/functions/pipeline-crm/index.ts`

A backend function that proxies Pipeline CRM API calls:

- Requires two secrets: `PIPELINE_CRM_API_KEY` and `PIPELINE_CRM_APP_KEY`
- Endpoints exposed via action parameter:
  - `list_deals`: GET `/api/v3/deals.json` with pagination (200 per page max)
  - `get_deal`: GET `/api/v3/deals/{id}.json` including associated files
  - `list_files`: GET `/api/v3/files.json` filtered by deal
  - `get_file`: GET `/api/v3/files/{id}.json` to download attached PDFs
  - `sync_deals`: Paginate all deals and upsert into a new `crm_deals` table
- Auth: passes `api_key` and `app_key` as URL params per Pipeline CRM docs

#### Part 4: Database Schema for CRM Deal Tracking

**New migration** -- create tables:

```sql
CREATE TABLE public.crm_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  crm_deal_id text NOT NULL,
  deal_name text,
  deal_value numeric,
  stage text,
  status text,
  close_date date,
  company_name text,
  synced_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}',
  UNIQUE(user_id, crm_deal_id)
);

ALTER TABLE public.crm_deals ENABLE ROW LEVEL SECURITY;

-- RLS policies: users see only their own synced deals
CREATE POLICY "Users can view own deals" ON public.crm_deals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own deals" ON public.crm_deals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own deals" ON public.crm_deals
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Link table: drawing sets → estimates → outcomes
CREATE TABLE public.estimate_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  crm_deal_id text,
  quoted_weight_kg numeric,
  quoted_price numeric,
  actual_weight_kg numeric,
  actual_cost numeric,
  award_status text DEFAULT 'pending',
  change_orders_total numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.estimate_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own outcomes" ON public.estimate_outcomes
  FOR ALL TO authenticated USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

#### Part 5: CRM Sync UI

**File**: `src/pages/Dashboard.tsx` (or new component)

Add a "CRM Sync" section to the dashboard:

- "Sync from Pipeline CRM" button that calls the `pipeline-crm` edge function with `sync_deals` action
- Display synced deals in a table: deal name, value, stage, status, close date
- Allow linking a deal to an existing project (sets `crm_deal_id` on `estimate_outcomes`)
- Show outcome tracking: quoted vs actual weight/cost when available

#### Part 6: Secrets Setup

Two new secrets needed:
- `PIPELINE_CRM_API_KEY` -- the user's Pipeline CRM API key
- `PIPELINE_CRM_APP_KEY` -- the app key from Pipeline CRM integration settings

### Implementation Order

1. Add `pdfjs-serverless` PDF text extraction directly into `analyze-blueprint/index.ts`
2. Update prompt to prioritize PDF-native text over OCR
3. Create `crm_deals` and `estimate_outcomes` tables via migration
4. Request Pipeline CRM API secrets from user
5. Create `pipeline-crm` edge function
6. Add CRM sync UI to dashboard

### What Stays the Same

- Google Vision triple OCR (still used for images and scanned PDF pages)
- Gemini multimodal analysis (still receives PDF images for visual context)
- All existing bar_lines extraction logic and pricing math
- Detection V2 pipeline, scope UI, estimation group filtering
- Authentication, exports, shop drawings

