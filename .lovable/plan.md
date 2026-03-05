

## Fix: Stage-Aware Vision Probe with Per-Stage Diagnostics

### Root Cause

The `GOOGLE_VISION_SA_KEY` secret contains a 40-character hex string (likely a SHA1 fingerprint or API key hash), not a JSON service account object. The probe correctly fails at `sa_key_parse` stage, but the error output is confusing because it lacks stage context. The code itself is actually working — it never reaches the Vision API call because parsing fails first. The `latency_ms: 0` is expected since no network call happens.

However, the user wants richer stage-by-stage diagnostics so each probe failure is immediately diagnosable.

### Changes

**File**: `supabase/functions/ai-diagnostics/index.ts` — rewrite `probeVision` (lines 318-388)

Replace with a stage-tracking approach:

1. **Stage tracker object** accumulates results per stage:
```text
stages_completed: ["sa_key_parse", "jwt_sign", "token_exchange", "vision_call"]
failed_stage: "sa_key_parse" | "jwt_sign" | "token_exchange" | "vision_call" | null
```

2. **Per HTTP stage** (`token_exchange`, `vision_call`), capture:
   - `url`, `http_status`, `content_type`, `response_length`, `response_text_first_200`
   - `parse_attempted`, `parse_result` ("ok" | "failed" | "skipped_non_json")

3. **Safe JSON parse helper**: read as text first, only parse if content-type includes `application/json` OR text starts with `{`

4. **Return shape on failure**:
```json
{
  "success": false,
  "failed_stage": "sa_key_parse",
  "error": "Not valid JSON service account key",
  "error_class": "bad_config",
  "stages": {
    "sa_key_parse": { "status": "failed", "detail": "40-char hex, not JSON", "first_chars": "534a...", "length": 40 }
  },
  "latency_ms": 0
}
```

5. **Return shape on success**:
```json
{
  "success": true,
  "failed_stage": null,
  "stages": {
    "sa_key_parse": { "status": "ok", "parse_method": "direct" },
    "jwt_sign": { "status": "ok" },
    "token_exchange": { "status": "ok", "http_status": 200, "latency_ms": 150 },
    "vision_call": { "status": "ok", "http_status": 200, "response_count": 1, "latency_ms": 280 }
  },
  "latency_ms": 430
}
```

### Note on Root Cause

The Vision probes will continue to fail until the `GOOGLE_VISION_SA_KEY` secret is updated with a real JSON service account key (starts with `{"type":"service_account",...}`). The current value is a 40-char hex string. This fix ensures the failure is clearly reported with actionable diagnostics.

| File | Change |
|---|---|
| `supabase/functions/ai-diagnostics/index.ts` | Rewrite `probeVision` with stage tracking, per-stage HTTP diagnostics, safe JSON parsing |

