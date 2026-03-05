

## Fix: Support Base64-Encoded SA Key in Vision Probe

### Problem
`GOOGLE_VISION_SA_KEY` contains a 40-char hex string — not a JSON service account key. The `safeParseSAKey` function only tries JSON parsing, so it always fails. The stored value is likely a secret ID/hash, not the actual key content.

### Plan

**File**: `supabase/functions/ai-diagnostics/index.ts`

#### 1. Update `safeParseSAKey` to support base64 decoding
Before attempting JSON parse, check if the string looks like base64 (no `{` prefix, matches base64 charset). If so, decode it first, then JSON parse.

```text
safeParseSAKey flow:
  ├─ Strip BOM, trim
  ├─ If starts with "{" → direct JSON parse
  ├─ Else try base64 decode → then JSON parse (method: "base64")
  ├─ Else try double-encoded JSON
  └─ Else fail with descriptive error
```

#### 2. Add SA key validation after successful parse
After parsing, validate required fields:
- `client_email` must be present
- `private_key` must contain `"-----BEGIN PRIVATE KEY-----"`
- `token_uri` should be present (or default to Google's)

If invalid, return a clear error: `"SA key parsed but missing required fields (client_email, private_key)"`

#### 3. Improve error message for non-JSON/non-base64 input
When the value is a hex string or other non-key format, return:
```json
{
  "error": "GOOGLE_VISION_SA_KEY is not a valid service account key. Expected JSON or base64-encoded JSON. Got 40-char hex string.",
  "error_class": "bad_config",
  "hint": "Store the full JSON content from your Google Cloud service account file, or base64-encode it."
}
```

#### 4. Action needed from user
The core issue is that `GOOGLE_VISION_SA_KEY` doesn't contain the actual key. The user needs to update it with the real JSON content (or base64 of it). The code changes make the error message actionable and add base64 support for when they do update it.

| File | Change |
|---|---|
| `supabase/functions/ai-diagnostics/index.ts` | Update `safeParseSAKey` to try base64 decode, add SA key field validation, improve error messages |

