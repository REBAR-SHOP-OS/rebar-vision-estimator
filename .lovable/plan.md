

## Plan: Fix Step-by-Step "Structured Output Not Returned" Warning + Payload Overflow

### Problem 1: False warning in Step-by-Step mode
Line 922 calls `handlePostStream(fullContent, chatHistory, mode)` with `expectStructuredOutput` defaulting to `true`. In step-by-step mode, the first AI response is an interactive Step 1 analysis — it never contains the `%%%ATOMIC_TRUTH_JSON%%%` block. This triggers the false "structured output was not returned" warning every time.

**Fix**: Pass `expectStructuredOutput = false` for step-by-step mode on the initial call (line 922). Only smart mode should expect structured output on the first pass.

```
// Line 922
await handlePostStream(fullContent, chatHistory, mode, mode === "smart");
```

### Problem 2: Payload still exceeding 500KB (413 error)
The client-side trim targets 450KB but only trims `pre_ocr_results`. The `pre_extracted_text` array (from `extract-pdf-text`) can also be large and is never trimmed. For scanned PDFs, both `pre_extracted_text` (with `skipped_reason`) AND `pre_ocr_results` are sent — the former is redundant when OCR results exist.

**Fix** in `streamAIResponse` (around line 363-392):
- When `trimmedOcrResults.length > 0`, clear `pre_extracted_text` to empty array (OCR supersedes it)
- Lower the aggressive-trim threshold from 450KB to 400KB, target 350KB
- As a final safety valve, if still over 480KB after trimming, truncate all `fullText` fields to 300 chars

### Scope
- 1 file: `src/components/chat/ChatArea.tsx`
- ~10 lines changed
- No backend changes

