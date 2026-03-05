

## Plan: Production-Stabilize All AI Routes

### 1. Replace preview model in `generate-shop-drawing`
- Change `google/gemini-3-flash-preview` → `google/gemini-2.5-flash` (stable, non-preview)
- Add `temperature: 0.2` (shop drawings need some creativity for HTML generation but should be consistent)

### 2. Add deterministic settings to non-generative routes
Each AI call gets explicit `temperature`, `top_p`, and `max_tokens`:

| Route | Model | temperature | top_p | max_tokens |
|---|---|---|---|---|
| analyze-blueprint | google/gemini-2.5-pro | 0 | 1 | 16384 |
| detect-project-type | google/gemini-2.5-flash | 0 | 1 | 2048 |
| extract-learning | google/gemini-2.5-flash-lite | 0 | 1 | 1024 |
| analyze-outcomes | google/gemini-2.5-flash | 0 | 1 | 4096 |
| generate-shop-drawing | google/gemini-2.5-flash | 0.2 | 1 | 16384 |

### 3. Add `pinned_model` tracking to diagnostics registry
Each integration entry gets new fields:
- `pinned_model` — the exact model string used at runtime (same as `model` for now since Lovable gateway resolves aliases)
- `is_preview` — `true` if model contains "preview"
- `is_pinned` — `true` (all models are now explicit stable versions)

### 4. Guardrails in `/ai-diagnostics`
- Manifest output includes `is_preview` and `is_pinned` per integration
- In verify mode: if any production route has `is_preview=true` OR `is_pinned=false`, return HTTP 500
- Update `validateIntegrations()` to check for preview models

### 5. Audit logging helper
Create a shared `logAiCall()` function pattern. Each edge function logs after every AI call:
```
{ route, provider, gateway, pinned_model, latency_ms, success, fallback_used }
```
Using `console.log(JSON.stringify({...}))` so it appears in edge function logs.

### Files to modify
1. **`supabase/functions/generate-shop-drawing/index.ts`** — swap model, add temperature/top_p/max_tokens, add audit log
2. **`supabase/functions/analyze-blueprint/index.ts`** — add temperature:0, top_p:1, max_tokens:16384, add audit log
3. **`supabase/functions/detect-project-type/index.ts`** — add temperature:0, top_p:1, max_tokens:2048, add audit log
4. **`supabase/functions/extract-learning/index.ts`** — add temperature:0, top_p:1, max_tokens:1024, add audit log
5. **`supabase/functions/analyze-outcomes/index.ts`** — add temperature:0, top_p:1, max_tokens:4096, add audit log
6. **`supabase/functions/ai-diagnostics/index.ts`** — update registry with pinned_model/is_preview/is_pinned, add guardrail in verify mode

