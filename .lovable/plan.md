

## Fix: Cloud Vision Probe Failure — Malformed Service Account Key

### Problem
The `probeVision` function in `ai-diagnostics/index.ts` calls `JSON.parse()` on the `GOOGLE_VISION_SA_KEY` env var. The error `Unexpected non-whitespace character after JSON at position 3` means the stored secret value is either:
- Double-encoded (JSON stringified twice)
- Has a BOM or invisible characters prepended
- Was truncated during entry

### Fix

Update the `probeVision` function in `supabase/functions/ai-diagnostics/index.ts` to:

1. **Trim and strip BOM** before parsing: `saKey.replace(/^\uFEFF/, '').trim()`
2. **Handle double-encoding**: If `JSON.parse` fails, try `JSON.parse(JSON.parse(saKey))` (common when pasting into secret fields)
3. **Report the actual first 20 chars** (non-secret) in the error for debugging: e.g., `"first_chars": "eyJ..."` so the user can confirm the format

### File Change

| File | Change |
|---|---|
| `supabase/functions/ai-diagnostics/index.ts` | Update `probeVision` to handle BOM, double-encoding, and report diagnostic detail on parse failure |

