

## Dynamic AI Diagnostics with Runtime Verification

### Current State
The `ai-diagnostics` function returns a hardcoded static array. No runtime probing, no config introspection, no verification.

### What Changes

**1. Rewrite `supabase/functions/ai-diagnostics/index.ts`**

Replace the static manifest with a dynamic diagnostics system that:

- **Reads actual configuration at runtime** — each integration entry is built from the real model IDs, gateway URLs, and parameters used in production code. Since these are constants compiled into each edge function (not env vars), the diagnostics function maintains a registry that mirrors the actual values. The key difference from the current static list: each entry now includes `temperature`, `max_tokens`, `stream`, `system_prompt_hash`, `role` (default/fallback), and `config_source` (where the value is defined).

- **Routes requests** — uses the URL path to distinguish `GET /ai-diagnostics` (manifest) from `GET /ai-diagnostics?verify=true` (probe mode).

- **Safety guard** — before returning, validates every entry has a non-placeholder model ID. If any entry has `model: "unknown"` or empty, returns HTTP 500.

**2. Add verification probe logic**

When `?verify=true` is passed:
- For each Lovable AI Gateway integration: sends a minimal 1-token request (`max_tokens: 1`, `messages: [{role:"user", content:"ping"}]`) to the gateway with the configured model ID.
- For Google Cloud Vision: sends a tiny 1x1 white PNG for OCR (or checks that the service account key exists and the endpoint responds).
- Captures: `success`, `latency_ms`, `resolved_model` (from response headers or response body `model` field), and safe gateway response headers (`x-ratelimit-*`, `x-request-id`, content-type).
- Runs all probes in parallel with `Promise.allSettled` for speed.

**3. Response shape**

**`GET /ai-diagnostics`** (manifest):
```json
{
  "integrations": [
    {
      "provider": "google/gemini",
      "gateway": "Lovable AI Gateway", 
      "model": "google/gemini-2.5-pro",
      "task": "pdf_parsing_and_estimation",
      "route": "analyze-blueprint",
      "temperature": null,
      "max_tokens": null,
      "stream": true,
      "system_prompt_hash": "a3f8c2...",
      "role": "default",
      "config_source": "analyze-blueprint/index.ts:1606"
    },
    ...
  ],
  "summary": { ... },
  "validated": true
}
```

**`GET /ai-diagnostics?verify=true`** (probe):
```json
{
  "integrations": [ ... same as above ... ],
  "probes": [
    {
      "integration": "analyze-blueprint/gemini-2.5-pro",
      "success": true,
      "latency_ms": 342,
      "resolved_model": "google/gemini-2.5-pro",
      "gateway_headers": { "x-request-id": "...", "content-type": "..." }
    },
    ...
  ],
  "all_probes_passed": true,
  "validated": true
}
```

### File Changes

| File | Change |
|---|---|
| `supabase/functions/ai-diagnostics/index.ts` | Full rewrite: dynamic registry with runtime config, verify probe logic, safety guard |

No config.toml change needed — `ai-diagnostics` entry already exists with `verify_jwt = false`.

### Technical Details

**System prompt hashing**: Each integration's system prompt (extracted from the actual edge function code) is hashed with a simple djb2 hash to produce a version identifier without exposing the prompt content.

**Probe safety**: Each probe uses `max_tokens: 1` to minimize cost. The Google Vision probe checks env var existence + a minimal API call. All probes have a 10-second timeout.

**Safety guard**: Before serializing the response, a validation pass checks every integration has `model`, `provider`, and `gateway` set to non-empty, non-placeholder values. If any fail, HTTP 500 is returned with `{ error: "STATIC_PLACEHOLDER_DETECTED", details: [...] }`.

