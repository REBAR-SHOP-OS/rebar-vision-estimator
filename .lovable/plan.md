

## Plan: Fix Smart Mode Blocking and Make Both Modes Consistent

### Problem
The Smart mode prompt says "Execute ALL pipeline stages automatically" but the MASTER_PROMPT's FAIL-CLOSED rules (R1, R5) cause the AI to **stop the entire estimation** when it encounters missing data (e.g., a missing Pile Schedule). Instead of estimating what it CAN and flagging what's BLOCKED, it writes a long philosophical explanation about why it stopped.

The user sees this as "freezing" and "inconsistency" — Smart mode should produce results for everything it CAN estimate, with BLOCKED items clearly listed but NOT stopping the whole pipeline.

### Root Cause
In `supabase/functions/analyze-blueprint/index.ts`, the Smart mode section (lines 780-806) only says:
> "Execute ALL pipeline stages automatically without pausing for user input."

It has **no instruction** about how to handle missing data gracefully. The FAIL-CLOSED rules from the MASTER_PROMPT take over and the AI interprets "BLOCKED" as "stop everything and explain why."

### Changes (1 file: `supabase/functions/analyze-blueprint/index.ts`)

#### 1. Add "Never Stop" directive to Smart mode prompt (~line 781)

After "Execute ALL pipeline stages automatically without pausing for user input", add clear instructions:

```
### CRITICAL: NEVER STOP THE PIPELINE
- If data is missing for some elements (e.g., missing pile schedule, missing detail sheet), mark those specific elements as BLOCKED with status="BLOCKED" and reason="MISSING: [what's missing]".
- CONTINUE estimating ALL other elements that DO have sufficient data.
- ALWAYS output the structured JSON (%%%ATOMIC_TRUTH_JSON_START%%%) with whatever elements ARE computable.
- A partial estimate with BLOCKED items is ALWAYS better than no estimate at all.
- Do NOT write long explanations about why you stopped. Instead, list blocked items in a brief summary table and proceed.
- The FAIL-CLOSED rule applies PER ELEMENT, not to the entire project. If 5 of 8 elements have data, estimate those 5 and block 3.
```

#### 2. Add equivalent handling to Step-by-Step prompt (~line 859)

After the "CRITICAL RULES" section, add:

```
### Handling Missing Data
- If data is missing for some elements, mark them BLOCKED and continue with remaining elements.
- Present blocked items clearly to the user and ask if they want to provide the missing data or proceed without those elements.
- NEVER stop the entire estimation because some elements are blocked.
- Always produce the structured JSON for elements that ARE computable.
```

#### 3. Refine the MASTER_PROMPT FAIL-CLOSED scope (~line 319)

Add a clarification after the NON-NEGOTIABLE RULES header:

```
IMPORTANT: FAIL-CLOSED applies PER ELEMENT, not per project. If an element lacks critical data, that element is BLOCKED. Other elements with sufficient data MUST still be estimated and output as READY or FLAGGED.
```

### Scope
- 1 file: `supabase/functions/analyze-blueprint/index.ts`
- ~20 lines added to system prompts
- No frontend changes needed — the `handlePostStream` already handles partial results correctly

