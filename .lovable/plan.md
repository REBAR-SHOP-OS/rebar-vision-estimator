

## Fix: Cloud Vision Probe — Real API Call with Error Classification

### Problem
The current `probeVision` only checks if the service account key parses as JSON. It never actually calls the Vision API, so it can't validate connectivity. The user wants a real HTTP probe with structured error handling.

### Changes

**File**: `supabase/functions/ai-diagnostics/index.ts` — rewrite `probeVision` function (lines 252-283)

**New logic**:

1. Parse SA key (keep existing `safeParseSAKey`)
2. Generate a Google OAuth2 access token from the service account key using JWT → token exchange
3. POST to `https://vision.googleapis.com/v1/images:annotate` with a 1x1 transparent PNG and `TEXT_DETECTION`
4. Handle response with structured error classification:

```text
probeVision flow:
  ├─ No env var → error: "GOOGLE_VISION_SA_KEY not configured"
  ├─ SA key parse fails → error with first_chars + length
  ├─ Token exchange fails → error_class: "auth_error"
  └─ Vision API call:
       ├─ 401/403 → error_class: "auth_error"
       ├─ 429 → error_class: "quota_error"  
       ├─ 400 → error_class: "bad_request"
       ├─ Content-Type != json → error_class: "non_json_response", response_snippet
       ├─ 200 + "responses" array → success: true
       └─ timeout/network → error_class: "network_error"
```

5. Read response as **text first**, then attempt `JSON.parse` only if `Content-Type` includes `application/json`
6. On non-JSON response, return `{ http_status, content_type, response_snippet_first_200_chars }`
7. Measure `latency_ms` from start to end regardless of outcome

**JWT signing for Google SA**: Use Web Crypto API (`crypto.subtle.importKey` + `crypto.subtle.sign` with RSASSA-PKCS1-v1_5) to sign the JWT with the SA private key — no external dependencies needed in Deno.

**Tiny probe image**: Hardcoded base64 of a 1x1 transparent PNG (~68 bytes base64).

No other files change.

