# Blueprint Fine-Tuning Patch #1+#2

Pure regex additions to the OCR extractor. No schema changes, no UI changes, no new tables.

## Files Touched

1. **`supabase/functions/populate-search-index/index.ts`** — extend `extractBarCallouts()` and add new `extractSpecs()`
2. **`supabase/functions/reindex-extractors/index.ts`** — same additions, so the existing "Re-index OCR Entities" button backfills both

Both files share identical regex helpers (already duplicated by design — keeps edge functions self-contained per project rules).

---

## Change 1 — Extended Bar Callouts (Patch #2 from prior list)

Add modifier capture to `extractBarCallouts()`. Same return shape, new optional `placement` field.

New patterns recognized:
- `15M @ 300 EW` → `placement: "EW"` (each way — doubles linear meters)
- `20M @ 250 EF` → `placement: "EF"` (each face — doubles count)
- `15M @ 200 T&B` / `BW` → `placement: "T&B"`
- `4-25M CONT` → `placement: "CONT"` (continuous, no spacing needed)
- `10M TIES @ 200` / `STIRR` → `placement: "TIES"` or `"STIRR"`
- `15M DWLS @ 400` → `placement: "DWL"`
- `(2)-25M` / `2-#8 BUNDLE` → `bundled: true, qty: 2`

Each pattern keeps the existing `seen` dedup and pushes to the same `bar_callouts` array. `auto-estimate` already reads `bar_callouts[]`; it can now branch on `placement` to multiply correctly.

Pre-clean step added at the top of the function:
- Normalize en/em-dash to `-`
- Collapse `1 5 M @ 3 0 0` → `15M@300` via `/(\d)\s+(?=[MmM#])/` and similar
- Uppercase all modifiers before matching

## Change 2 — Spec / General-Notes Extractor (Patch #6 from prior list)

New helper `extractSpecs(text: string): Record<string, unknown>` returning a flat object:

```
{
  cover: { bottom_mm, top_mm, side_mm, against_earth_mm },
  lap: { tension_db, compression_db, splice_type },
  hook: { standard_deg, seismic_deg },
  grade: { fy_mpa, mark }, // e.g. "400W", "500W", "Grade 60"
  detected_keywords: [...]
}
```

Patterns:
- Cover: `COVER[:\s]+(\d+)\s*MM\s+(BOTTOM|TOP|SIDE|EARTH)` (multi-pass)
- Lap: `(TENSION|COMPRESSION)\s+LAP\s*=?\s*(\d+)\s*DB`
- Hook: `(STD|SEISMIC|STANDARD)\s+HOOK\s*=?\s*(90|135|180)`
- Grade: `(?:Fy|GRADE)\s*=?\s*(\d{2,3})\s*(?:MPA|KSI)?` plus `\b(400W|500W|Grade\s*60)\b`
- Splice: `(MECHANICAL\s+COUPLER|LAP\s+SPLICE|WELDED\s+SPLICE)`

Output injected into `extracted_entities.specs` per page. Pages with no spec hits get `specs: {}` (cheap).

A second pass aggregates per-project after all pages processed: pick the page with the most spec hits as the authoritative one, log to `audit_events` with `action: "spec_extracted"` and `metadata: { specs, source_page }`. No new table — `auto-estimate` reads from the latest `audit_events` of that action for the project, falling back to `standards_profiles` defaults if empty.

## Out of Scope

- `auto-estimate` consumption of new fields (separate patch)
- Sheet-category gating (#5) — separate patch
- Cross-page reconciliation (#8) — separate patch
- Bar schedule shape codes (#4) — separate patch
- Geometry/bbox coupling (#9) — separate patch
- Dimension kind tagging (#3) — separate patch

## Validation After Deploy

1. Click "Re-index OCR Entities" on the active project
2. Run SQL check on `drawing_search_index.extracted_entities` for non-empty `specs` and any `bar_callouts[].placement` field
3. Read `audit_events` where `action = 'spec_extracted'` for the project
4. Toast in Takeoff stage will report new callouts/dims/schedule rows

No regression risk for existing rows — all new fields are additive; readers ignoring unknown keys keep working.
