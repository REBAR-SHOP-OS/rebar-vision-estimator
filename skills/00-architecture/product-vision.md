# Product Vision

Two-layer product:

- **Office Layer** — analyst/estimator workspace. Trust-First UX:
  every value carries provenance, uncertainty is shown, nothing is invented.
- **Shop-Floor / Output Layer** — deterministic exports (PDF, Excel,
  shop drawings) gated behind validation. Three export modes:
  `ai_candidate` (sketch), `review_draft` (workflow), `issued` (deterministic).

## Non-negotiables

1. AI never silently overrides source data.
2. Every line item links back to a source page/region.
3. Issued exports require all validation gates green.
4. Pipeline fails *closed at the element level*, never stops the whole batch.
5. Minimum-patch policy on every code change.