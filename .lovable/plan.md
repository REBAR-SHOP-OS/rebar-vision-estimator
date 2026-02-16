
## Full Project Audit, Diagnosis & Improvement Plan

Based on thorough code review, edge function logs, and the new Beam AI rebar/detailing document, here are all identified issues and improvements organized by priority.

---

### CRITICAL BUG FIX: Google Vision SA Key Parse Error

**Problem:** Edge function logs show:
```
Failed to get Google Vision token: SyntaxError: Unexpected non-whitespace character after JSON at position 3
```
The `GOOGLE_VISION_SA_KEY` secret has encoding issues. The `JSON.parse()` on line 35 of `analyze-blueprint/index.ts` fails because the stored value likely has BOM characters or extra whitespace/escaping.

**Fix:** Add resilient parsing in `getGoogleAccessToken()`:
- Trim whitespace and BOM characters before parsing
- Try multiple decode strategies (raw JSON, URL-decoded, base64-decoded)
- Log first 20 characters of the raw value for diagnosis
- Provide clear error message if all strategies fail

---

### CRITICAL BUG FIX: Step Progress Never Advances

**Problem:** `onStepChange(1)` is called once when mode is selected (line 398), but never updated as the AI streams. The sidebar spinner stays on step 1 at 0% forever.

**Fix in `ChatArea.tsx`:**
- Parse step markers from streamed content (e.g., "Step 1", "Step 2", "Step 3") in the streaming loop
- Call `onStepChange()` with the detected step number as tokens arrive
- After streaming completes, set step to final (9 = done)

---

### CRITICAL BUG FIX: "Section 2: Structured JSON Block" Visible in Chat

**Problem:** The regex strips JSON between markers but the markdown header "Section 2: Structured JSON Block" before the markers remains visible to users.

**Fix in `ChatMessage.tsx`:**
- Expand regex to also strip "Section 2" header and related text preceding the JSON markers

---

### BUG FIX: `streamAIResponse` Stale Closure

**Problem:** `useCallback` on line 278 has empty dependency array `[]`, so `scopeData` (used on line 193) is always captured as `null`.

**Fix:** Add `scopeData` to the dependency array, or use a ref to always read the latest value.

---

### IMPROVEMENT: Processing Phase Indicator

**Problem:** `StepProgress` has a `processingPhase` prop but `Dashboard.tsx` never passes it (line 182).

**Fix:**
- Add `processingPhase` state in `Dashboard.tsx`
- Add `onProcessingPhaseChange` callback prop to `ChatArea`
- Set phase text during streaming: "Running Google Vision OCR...", "AI Analysis in progress...", "Validating elements..."

---

### IMPROVEMENT: Enhanced Rebar-Specific Features (from Document)

Based on the new rebar/detailing executive summary:

1. **Add BEAM to ScopeDefinitionPanel** -- currently missing from SCOPE_ITEMS (line 11-24) even though it's in ALLOWED_ELEMENT_TYPES
2. **Add Bar List / Bending Schedule concept** to the system prompt -- extend the Atomic Truth schema to include:
   - `bar_mark` (bar mark ID like "A1", "B3")
   - `shape_code` (straight, L-bend, U-bend, hook)  
   - `bend_details` (leg lengths, hook extensions)
   - `splice_length` for overlap accounting
3. **Enhance price-elements** to compute developed length (including hooks/bends) instead of just default lengths
4. **Add "Bar List" export sheet** to Excel export with: Bar Mark, Size, Shape, Qty, Length, Weight
5. **Add Bending Schedule export sheet** with shape codes and bend dimensions

---

### IMPROVEMENT: Enhanced Export (from Document)

**ExportButtons.tsx enhancements:**
- Add a "Bar List" sheet to Excel export with bar marks and shape codes
- Add a "Bending Schedule" sheet with bend type, count, and leg dimensions
- Improve PDF export with better formatting and company logo placeholder
- Add CSV export option for bar lists

---

### IMPROVEMENT: Rebar Type Identification in Scope

**ScopeDefinitionPanel.tsx:**
- Add rebar type selection (Black Steel, Epoxy-Coated, Galvanized, Stainless Steel) as additional scope parameter
- Pass this to the system prompt so AI focuses on the correct coating type

---

### IMPROVEMENT: Better Error Handling

**ChatArea.tsx:**
- Handle 429 (rate limit) and 402 (credits) errors from the edge function with user-friendly toast messages
- Add retry logic for transient failures

---

### Technical Details

| File | Change Type | Priority |
|---|---|---|
| `supabase/functions/analyze-blueprint/index.ts` | Fix SA key parsing; add bar mark/shape to schema; inject processing phase markers | Critical |
| `src/components/chat/ChatArea.tsx` | Fix stale closure; parse step markers from stream; add processingPhase callback; handle 429/402 | Critical |
| `src/components/chat/ChatMessage.tsx` | Expand regex to strip "Section 2" header | Critical |
| `src/pages/Dashboard.tsx` | Add processingPhase state and pass to StepProgress | Medium |
| `src/components/chat/ScopeDefinitionPanel.tsx` | Add BEAM type; add rebar coating selection | Medium |
| `src/components/chat/ExportButtons.tsx` | Add Bar List and Bending Schedule sheets | Medium |
| `supabase/functions/price-elements/index.ts` | Add developed length calculation with hooks/bends | Medium |
| `supabase/functions/validate-elements/index.ts` | Add bar_mark and shape_code validation rules | Low |

### Execution Order

1. Fix Google Vision SA key parsing (analyze-blueprint) -- unblocks OCR
2. Fix ChatMessage.tsx regex -- removes visible JSON header
3. Fix ChatArea.tsx stale closure + step parsing + error handling
4. Update Dashboard.tsx with processingPhase
5. Add BEAM to ScopeDefinitionPanel + rebar type selection
6. Enhance system prompt with bar mark/shape/bend schema
7. Update price-elements with developed length logic
8. Enhance ExportButtons with bar list and bending schedule sheets
9. Deploy all edge functions
