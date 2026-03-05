

## Update GOOGLE_VISION_SA_KEY Secret

### Problem
Previous attempts to save the full Service Account JSON into `GOOGLE_VISION_SA_KEY` failed -- the secret still contains only the 40-char `private_key_id` hex string. This is likely due to the multi-line `private_key` field being truncated during the secret update flow.

### Plan

1. **Update the secret** using the add/update secret tool (once I switch to implementation mode) with the **minified single-line JSON** from the uploaded file `rebar-shop-floor-a510c960e1d0-4.json`. The value will be the entire JSON object on one line with no extra whitespace, ensuring the `private_key` field (with its `\n` escape sequences) is preserved intact.

2. **Verify** by calling the `ai-diagnostics` edge function to confirm the Vision API probe passes (i.e., the key parses correctly and can sign a JWT).

### Important
When the secret update prompt appears, paste the **entire JSON content as a single line** -- do not add line breaks. The uploaded file content is ready to use as-is.

