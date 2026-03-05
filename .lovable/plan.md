## Master Prompt Integration — COMPLETED

The Master Prompt (Zero-Trust, Dual-Analysis, 12-rule protocol) has been integrated as the core system prompt in `analyze-blueprint`. 

### What Changed
- **Removed**: `PIPELINE_INSTRUCTIONS`, `SMART_PROJECT_DETECTION`, `RSIC_ESTIMATING_RULES` (subsumed by Master Prompt)
- **Added**: `MASTER_PROMPT` constant containing the full protocol (Parts 1, 1B, 2)
- **Rewired**: `SMART_SYSTEM_PROMPT` and `STEP_BY_STEP_SYSTEM_PROMPT` now use `MASTER_PROMPT`
- **Kept**: `ELEMENT_UNIT_SCHEMA`, `REBAR_WEIGHT_TABLE`, `CANADIAN_METRIC_TABLE`, `OUTPUT_FORMAT_INSTRUCTIONS`, `getCategorySpecificRules()`, Agent Brain injection (Stage 0/10)
