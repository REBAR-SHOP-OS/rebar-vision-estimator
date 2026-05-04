# Atomic Truth Envelope

Pattern: every extraction response is preceded by a machine-readable JSON
envelope so the client can parse it deterministically before any prose renders.

```text
%%%ATOMIC_TRUTH_JSON_START%%%
{
  "elements": [ ... ],
  "validation": { "gates": { ... }, "blocked": false },
  "provenance": [ { "field": "qty", "source_page": 3, "bbox": [x,y,w,h] } ]
}
%%%ATOMIC_TRUTH_JSON_END%%%

(Optional human-readable narrative after the envelope.)
```

## Rules

- Envelope MUST be the first bytes of the response. No leading whitespace,
  no markdown fence, no prose.
- Pipeline FAILS CLOSED at the element level — one bad element does not stop
  the rest. Mark it with `"blocked": true` + reason instead.
- Provenance is mandatory. Any value without a source link is `UNVERIFIED_ASSUMPTION`.