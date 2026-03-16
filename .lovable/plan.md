

# Fix: "No HTML Returned" from Shop Drawing Generation

## Root Cause

The network response confirms the API returns `{"html":""}` — an empty string. The edge function logs show `success:true` with ~21s latency, meaning the AI gateway responded 200 but the model returned empty content.

**Why**: The `logoDataUri` (a massive base64 PNG string — thousands of characters of C2PA-signed image data) is embedded directly in the prompt text. This bloats the prompt enormously, likely causing the model to return empty or truncated content. The base64 string visible in the request body is over 10KB of raw image data injected into the system prompt.

## Fix

**File: `supabase/functions/generate-shop-drawing/index.ts`**

1. **Remove `logoDataUri` from the AI prompt** — replace the inline base64 with a placeholder tag like `<!-- LOGO_PLACEHOLDER -->` in the prompt instructions
2. **Post-process the AI response** — after receiving the HTML, replace the placeholder with the actual logo data URI using string replacement
3. This keeps the prompt small and focused on layout/content generation

```
// Before sending to AI:
// In prompt: <img src="<!-- LOGO_PLACEHOLDER -->" .../>

// After receiving HTML:
html = html.replace(/<!-- LOGO_PLACEHOLDER -->/g, logoDataUri || "");
```

Also add a debug log for the actual AI response content length to catch empty responses:
```typescript
console.log("AI response content length:", html.length);
if (!html) {
  console.error("AI returned empty content. Response:", JSON.stringify(data).substring(0, 500));
}
```

### Files Modified
- `supabase/functions/generate-shop-drawing/index.ts` — remove logo from prompt, inject post-generation, add debug logging

