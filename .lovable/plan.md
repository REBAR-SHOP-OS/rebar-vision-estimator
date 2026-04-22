

# Add AI Image Drafting to Shop Drawings

## What This Does

Adds an **"AI Visual Draft"** option to the Draft Shop Drawings export. Instead of (or in addition to) the deterministic 6-zone HTML template, the system will use **Nano Banana 2** (`google/gemini-3.1-flash-image-preview`) — Lovable AI's fastest pro-quality image model — to generate a visual sketch of each segment's rebar layout (plan view, elevation, sections) based on the real bar list and segment data.

> Note: Lovable AI does **not** currently offer a GPT image model (OpenAI's image API isn't on the gateway). The closest equivalent — and arguably better for engineering sketches — is **Nano Banana 2** (Gemini 3.1 Flash Image Preview). If you specifically want an OpenAI model, we'd need to add a custom OpenAI API key. Default plan uses Nano Banana 2.

## How It Works

```text
[Outputs tab] → "Draft Shop Drawings" → Export menu:
   ├─ HTML Sheet (current deterministic template)   ← unchanged
   └─ AI Visual Draft (NEW)
         ↓
   For each segment with bar items:
      1. Build prompt from bar list (marks, sizes, qty, shape codes)
      2. Call edge function → Lovable AI Gateway (Nano Banana 2)
      3. Receive base64 PNG sketch (plan + bar callouts)
      4. Embed all images into a single printable HTML sheet
      5. Save to `shop_drawings` table with `options.kind = "ai_visual"`
```

## Plan

### 1. New edge function: `draft-shop-drawing-ai`
**File**: `supabase/functions/draft-shop-drawing-ai/index.ts`
- Accepts `{ projectId, segmentId? }`
- Loads segments + bar_items + project metadata
- For each segment, builds a structured prompt:
  > "Generate a clean engineering plan-view sketch of [segment name]. Show rebar layout with bar marks [B1001, BS31, ...], sizes [10M, 15M, 20M], spacings, and a bar list table. Black & white, top-down orthographic, dimensioned, technical drawing style, no shading."
- Calls `google/gemini-3.1-flash-image-preview` via Lovable AI Gateway with `modalities: ["image", "text"]`
- Returns array of `{ segment_id, segment_name, image_data_uri, caption }`
- Handles 429 / 402 errors with clear toast messages

### 2. Extend `OutputsTab.tsx` — add second export button
**File**: `src/components/workspace/OutputsTab.tsx` (~30 lines added)
- Split the existing Shop Drawing card into two actions:
  - **"Export HTML Sheet"** (existing flow, unchanged)
  - **"Generate AI Visual Draft"** (NEW)
- New flow:
  1. Show progress toast ("Drafting visual sheets with AI…")
  2. Invoke `draft-shop-drawing-ai` edge function
  3. Wrap returned images in a printable HTML page (one image per segment, with title block + bar list table beside each)
  4. Save to `shop_drawings` table with `options.kind = "ai_visual"`, increment version
  5. Trigger download + open in new tab for Ctrl+P
- Reuses existing `verified-estimate` gate (export blocked if not verified)
- Reuses existing `logAuditEvent` and `export_jobs` insert

### 3. Optional small UI flag
The `shop_drawings.options` JSONB already supports arbitrary keys — no migration needed. History entries in `ShopDrawingModal.tsx` will show `kind: ai_visual` if you later open them.

## Technical Details

- **Model**: `google/gemini-3.1-flash-image-preview` (Nano Banana 2 — pro-quality, fast)
- **Gateway**: `https://ai.gateway.lovable.dev/v1/chat/completions` with `modalities: ["image", "text"]`
- **Auth**: `LOVABLE_API_KEY` (already in secrets)
- **Image size**: base64 PNGs returned by gateway, embedded inline (no storage upload needed for v1)
- **Cost guard**: cap at first 6 segments per call to control AI credit usage
- **Determinism**: AI sketches are visual drafts only — the deterministic HTML template remains the source of truth for fabrication numbers

## Files Modified
- `supabase/functions/draft-shop-drawing-ai/index.ts` — NEW (~120 lines)
- `src/components/workspace/OutputsTab.tsx` — add AI Visual button + handler (~50 lines)

