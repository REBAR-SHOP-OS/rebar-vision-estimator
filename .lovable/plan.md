

## Plan: Update GOOGLE_VISION_SA_KEY with Base64 Value & Test

### Steps

1. **Update the secret `GOOGLE_VISION_SA_KEY`** with the base64-encoded service account JSON using the `secrets` tool.

2. **Verify the parsing logic** — the existing code in `detect-project-type/index.ts` already tries base64 decoding as one of its parse strategies (line 28):
   ```ts
   if (!sa) { try { sa = JSON.parse(new TextDecoder().decode(decodeBase64(cleanJson))); } catch {} }
   ```
   So no code changes are needed.

3. **Test by calling** `GET /ai-diagnostics?verify=true` using the edge function curl tool to confirm Vision OCR works end-to-end.

### No code changes required
The existing multi-strategy parser already handles base64-encoded JSON secrets.

