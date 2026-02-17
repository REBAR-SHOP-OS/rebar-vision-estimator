

## Patch: Coverage Enforcement + Missing-Length Tracking + Weight Regression Test

### What's Already Done (no changes needed)
- bar_lines array in ELEMENT_UNIT_SCHEMA (analyze-blueprint lines 247-260)
- BAR-LINE-LEVEL EXTRACTION mandatory rule (lines 392-418)
- price-elements rewrite with bar_lines primary path (lines 113-153)
- SizeBreakdownTable with kg column
- ValidationResults with dual-unit display
- Detection veto regression tests

### Remaining Gap 1: Coverage Enforcement in analyze-blueprint

File: `supabase/functions/analyze-blueprint/index.ts`

Add to `OUTPUT_FORMAT_INSTRUCTIONS` (around line 421), inside the JSON schema block, a `coverage` object:

```text
"coverage": {
  "bar_lines_count": <total bar_lines across all elements>,
  "elements_count": <total elements>,
  "pages_processed": <number of blueprint pages analyzed>,
  "status": "OK" | "LOW_COVERAGE"
}
```

Add a rule to `PIPELINE_INSTRUCTIONS` (after the BAR-LINE-LEVEL EXTRACTION block, around line 418):

```text
## COVERAGE ENFORCEMENT (MANDATORY)
After completing extraction, count total bar_lines across all elements.
If pages_processed >= 5 AND bar_lines_count < 30:
  - Set coverage.status = "LOW_COVERAGE"
  - Re-scan ALL pages with stricter instructions: parse every callout, every table row, every note
  - Do NOT summarize — each bar specification is a separate bar_line entry
  - After re-scan, update bar_lines_count
If still LOW_COVERAGE after retry, flag it in the output so the user is warned.
```

### Remaining Gap 2: Missing-Length Tracking in price-elements

File: `supabase/functions/price-elements/index.ts`

In the `calculateElementWeight()` function, when iterating bar_lines (lines 114-150):
- Track bar lines where neither `length_mm` nor `length_ft` is provided AND no fallback `weight_kg` exists
- Add to the return type: `missing_length_count: number` and `missing_length_bars: string[]`
- In the response JSON, include these fields alongside the quote for debugging visibility

In the serve handler response (both ai_express and verified blocks):
- Sum `missing_length_count` across all elements
- Include `missing_length_count` and `missing_length_bars` at the top level of the response

### Remaining Gap 3: Weight Comparison Regression Test

File: `src/test/detection-regression.test.ts`

Add a new `describe("Weight Accuracy Regression")` block with:

- A helper function `checkWeightAccuracy(aiWeightKg, excelWeightKg, maxErrorPct)` that computes error percentage and asserts it's within threshold
- Test case for "20 York Valley": expected ~44,777 kg, threshold 25%
- A test that asserts: if `coverage.status === "LOW_COVERAGE"` in AI output, the test should warn (not hard-fail, since this is prompt-dependent)
- A fail condition test: `if primaryCategory === "cage_only" AND buildingSignals.length > 0 => FAIL`

These tests use static fixture data (not live edge function calls) to validate the pricing math in isolation.

### Technical Summary

| File | Change |
|---|---|
| `supabase/functions/analyze-blueprint/index.ts` | Add coverage object to OUTPUT_FORMAT_INSTRUCTIONS JSON schema; add COVERAGE ENFORCEMENT rule to PIPELINE_INSTRUCTIONS |
| `supabase/functions/price-elements/index.ts` | Track missing_length_count/missing_length_bars in calculateElementWeight; include in response JSON |
| `src/test/detection-regression.test.ts` | Add Weight Accuracy Regression describe block with threshold checks and fixture data |

### What Stays the Same
- All existing bar_lines extraction logic
- All existing pricing math (bar_lines primary, legacy fallback)
- Detection V2 pipeline and veto logic
- ScopeDefinitionPanel, estimation group filtering, exports, auth/db
- UI components (SizeBreakdownTable, ValidationResults)

