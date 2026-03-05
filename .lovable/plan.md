

## Plan: AI Diagnostics Edge Function

### What it does
A new edge function `ai-diagnostics` that returns a static manifest of all AI/ML providers used across the system, derived from the actual codebase audit below.

### Detected AI providers (from codebase scan)

| Function | Model | Provider | Usage |
|---|---|---|---|
| `analyze-blueprint` | `google/gemini-2.5-pro` | Lovable AI (Google) | PDF parsing, rebar estimation, structural reasoning |
| `analyze-blueprint` | Google Cloud Vision API | Google Cloud | OCR for scanned/raster PDF pages |
| `detect-project-type` | `google/gemini-2.5-flash` | Lovable AI (Google) | Project type classification from blueprints |
| `detect-project-type` | Google Cloud Vision API | Google Cloud | OCR for blueprint page thumbnails |
| `generate-shop-drawing` | `google/gemini-3-flash-preview` | Lovable AI (Google) | Shop drawing HTML generation |
| `extract-learning` | `google/gemini-2.5-flash-lite` | Lovable AI (Google) | Conversation learning extraction |
| `analyze-outcomes` | `google/gemini-2.5-flash` | Lovable AI (Google) | Estimation accuracy analysis, correction rules |

No Anthropic or OpenAI-direct usage found. All LLM calls go through Lovable AI Gateway. Google Vision is called directly via service account.

### Implementation

**New file**: `supabase/functions/ai-diagnostics/index.ts`
- Standard CORS + no-auth edge function
- Returns the hardcoded provider manifest as JSON (no dynamic scanning needed — the providers are static config)
- Each entry: `provider`, `model`, `gateway`, `function`, `usage`

**Update**: `supabase/config.toml` — add `[functions.ai-diagnostics]` with `verify_jwt = false`

### Response shape

```json
{
  "providers": [
    {
      "provider": "google/gemini",
      "model": "google/gemini-2.5-pro",
      "gateway": "Lovable AI",
      "function": "analyze-blueprint",
      "usage": "PDF parsing, rebar estimation, structural reasoning (streaming)"
    },
    {
      "provider": "google-cloud-vision",
      "model": "Cloud Vision API v1",
      "gateway": "Direct (Service Account)",
      "function": "analyze-blueprint",
      "usage": "OCR for scanned/raster PDF pages"
    }
  ],
  "summary": {
    "total_providers": 2,
    "total_models": 6,
    "gateways": ["Lovable AI Gateway", "Google Cloud Vision API (direct)"]
  }
}
```

