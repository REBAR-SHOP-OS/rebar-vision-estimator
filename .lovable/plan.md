

## Integrate Master Prompt as Core System Prompt in analyze-blueprint

### What This Does
Replaces the current fragmented system prompt constants (`PIPELINE_INSTRUCTIONS`, `SMART_PROJECT_DETECTION`, `RSIC_ESTIMATING_RULES`, `SMART_SYSTEM_PROMPT`, `STEP_BY_STEP_SYSTEM_PROMPT`) with the full **Master Prompt** as the single authoritative instruction source. This ensures the AI follows the complete Zero-Trust, Dual-Analysis, 12-rule protocol for every estimation.

### Changes to `supabase/functions/analyze-blueprint/index.ts`

**1. Add new constant: `MASTER_PROMPT`**
- Contains the entire Master Prompt text (Parts 1, 1B, and 2) as provided
- Placed after the existing `ELEMENT_UNIT_SCHEMA` constant (which is kept -- it defines the JSON output format)
- The rebar weight tables (`REBAR_WEIGHT_TABLE`, `CANADIAN_METRIC_TABLE`) are kept as separate constants since they're referenced data

**2. Replace `SMART_SYSTEM_PROMPT` construction**
- Currently assembles from: `PIPELINE_INSTRUCTIONS` + `ELEMENT_UNIT_SCHEMA` + `REBAR_WEIGHT_TABLE` + `CANADIAN_METRIC_TABLE` + `SMART_PROJECT_DETECTION` + `RSIC_ESTIMATING_RULES` + `OUTPUT_FORMAT_INSTRUCTIONS`
- New version: `MASTER_PROMPT` + `ELEMENT_UNIT_SCHEMA` + `REBAR_WEIGHT_TABLE` + `CANADIAN_METRIC_TABLE` + `OUTPUT_FORMAT_INSTRUCTIONS`
- The Master Prompt subsumes `PIPELINE_INSTRUCTIONS`, `SMART_PROJECT_DETECTION`, and `RSIC_ESTIMATING_RULES`

**3. Replace `STEP_BY_STEP_SYSTEM_PROMPT` similarly**
- Same base but with "execute ONE step at a time" mode instruction appended

**4. Keep unchanged:**
- `ELEMENT_UNIT_SCHEMA` (JSON output schema -- compatible with Master Prompt)
- `REBAR_WEIGHT_TABLE` and `CANADIAN_METRIC_TABLE` (reference data)
- `OUTPUT_FORMAT_INSTRUCTIONS` (JSON output markers)
- `getCategorySpecificRules()` function (category-specific overrides)
- Agent Brain injection logic (Stage 0 / Stage 10 / rules / training examples)
- All OCR, PDF extraction, file handling, and API call logic

**5. Constants removed (subsumed by Master Prompt):**
- `PIPELINE_INSTRUCTIONS` -- Master Prompt Stages 1-8 + Part 2 cover this
- `SMART_PROJECT_DETECTION` -- Master Prompt Stage 3 categories cover this
- `RSIC_ESTIMATING_RULES` -- Master Prompt Stage 5.5 + throughout covers this

### Key Additions from Master Prompt (not in current system)
- **12 Non-Negotiable Rules** (zero-hallucination, evidence-first, dual-analysis, risk flags, probabilistic ranges)
- **Stage 2.5 -- Rebar Type Identification** (7 rebar types with mandatory user question)
- **Stage 8 -- WWM detailed calculation** (overlap rules, sheet size logic, type identification)
- **Part 1B -- Dual-Analysis** (Drawing-Spec vs Industry-Norm estimates, risk flags, ranges)
- **Part 2 -- Shop-Drawing Search DB** (ingestion discipline, metadata requirements, search stack)
- **User-correction override rule** at every stage

### File: `supabase/functions/analyze-blueprint/index.ts`
- Lines ~402-531: Remove `PIPELINE_INSTRUCTIONS` (subsumed)
- Lines ~647-678: Remove `SMART_PROJECT_DETECTION` (subsumed)
- Lines ~680-728: Remove `RSIC_ESTIMATING_RULES` (subsumed)
- Lines ~730-770: Rewrite `SMART_SYSTEM_PROMPT` to use `MASTER_PROMPT`
- Lines ~772-840: Rewrite `STEP_BY_STEP_SYSTEM_PROMPT` to use `MASTER_PROMPT`
- Add `MASTER_PROMPT` constant (~200 lines of text)

