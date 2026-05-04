# Validation Gates Prompt

Six gates the AI must self-check before returning. If any gate fails, the
element is marked `blocked: true` with `gate_failed: <name>`.

1. **provenance** — every value has a `source_page` + region.
2. **internal_consistency** — totals match line items (±1 unit rounding).
3. **range_sanity** — values fall within domain-plausible bounds.
4. **unit_consistency** — all dims in one unit system per response.
5. **identifier_uniqueness** — no duplicate element ids.
6. **completeness** — required fields present; missing fields → `UNVERIFIED_ASSUMPTION`.

Append to system prompt:

```text
Before emitting JSON, run all 6 validation gates. For each element:
- mark blocked=true if any gate fails
- include {"gate_failed": "<name>", "reason": "<short>"}
- DO NOT silently drop the element
```