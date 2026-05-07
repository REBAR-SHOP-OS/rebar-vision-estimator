## Goal

Every unresolved QA question in Blueprint Estimator must read like:

> Look at Sheet S-403, Page 8. Find housekeeping pad HKP1. Enter the pad length and pad width from the drawing.

…not the current:

> Look at Page 1. Find the housekeeping pad. Enter…

The element **type** ("housekeeping pad") is not enough. We must surface and persist the specific **element ID** (HKP1, F12, WF3, GB2, W3, T.D.33, etc.) so the estimator knows exactly which object to inspect, on the correct sheet/page.

## Root causes (audited in code)

1. `supabase/functions/auto-estimate/index.ts` — `inferQaAnchorMeta()` extracts `callout_tag` (HKP1, F12, W3…) and `element_reference` *separately*, but `element_reference` is forced to the generic lowercased noun ("housekeeping pad"). The question builder lower in the file then uses only `element` (the generic noun) for the "marked …" phrase, dropping the actual ID.
2. The callout pattern `\b(BS?\d{2,4}|B\d{4}|F\d{1,3}|W\d{1,3}|GB\d{1,3}|D\d{2}(?:-\d+)?|P\d{1,3})\b` is missing common rebar element IDs (HKP\d+, FW\d+, WF\d+, SF\d+, SOG\d+, SL\d+, FZ\d+, COL\d+, PR\d+, T.D.\d+/TD\d+ as a *callout-style* ref, schedule keys like S-1, S-2).
3. `source_file_id` for unresolved rows defaults to whatever sheet matches the chosen anchor — but when no anchor is found, `_page_number` is null and `resolveRowSource()` falls back to the first non-architectural file → **Page 1 cover sheet** is shown as evidence.
4. `src/features/workflow-v2/takeoff-data.ts` — the same pattern is mirrored client-side in `inferObjectAnchor()` and `rewriteToRawInputAsk()`. The question text uses `calloutText` (which currently equals the generic element noun) for the "marked …" phrase, again dropping the ID.
5. `WorkflowQaIssue.location` does not carry an explicit `element_id` field, so QA UI / overlay labels cannot prefer the ID over the type.

## Fix plan (minimum-patch, three files)

### 1. `supabase/functions/auto-estimate/index.ts`

- **Expand the callout regex** in `inferQaAnchorMeta()` to also match: `HKP\d+`, `EQP\d+`, `FW\d+`, `WF\d+`, `SF\d+`, `SOG\d+`, `SL\d+`, `FZ\d+`, `COL\d+`, `PR\d+`, `PIER\d+`, `S-\d+`, `T\.?D\.?\s*\d+`. Keep existing matches.
- **Add a new structured field** `element_id` returned from `inferQaAnchorMeta()`, set to the *first ID-style token* found in description + excerpt + sheet (callout_tag for the host element). `element_reference` stays as the human noun ("housekeeping pad"). Both are persisted.
- **Persist `element_id`** in `assumptions_json` (alongside `callout_tag`, `element_reference`) and in `source_refs[0]` of the validation issue.
- **Use `element_id` in the question text**: change `findPart` to
  `the ${noun} ${element_id}` when `element_id` exists,
  else `the ${noun} marked "${element_reference}"`,
  else current excerpt fallback.
- **Use `element_id` in the title and `locLabel`**: append `element_id` after the noun (e.g. `"S-403 · P8 · HKP1: housekeeping pad — enter drawing dimensions"`).
- **Block Page-1 fallback for evidence**: in `resolveRowSource()`, if `_page_number` is null AND no sheet-tag match is found, return `null` instead of `defaultSourceId`, so the QA UI does not show a cover sheet as the source for an unresolved row. The QA panel already handles missing source gracefully.
- **Anchor candidates**: in `buildCandidates()`, push `element_id` first (highest-priority kind `"element_id"` with score `0.99`, treated as `"exact"`). This ensures page selection prefers the page where the actual ID appears, not a page where the generic noun appears.

### 2. `src/features/workflow-v2/takeoff-data.ts`

- **Mirror the regex expansion** in `inferObjectAnchor()` so legacy-loaded issues without re-running auto-estimate also surface `element_id`.
- **Add `element_id`** to the `WorkflowQaIssue["location"]` shape (optional string).
- **Read `element_id`** from `aj.element_id` / `ref.element_id` first in `extractLocationFromRef()`, fall back to inferred.
- **Update `buildLocationLabel()`**: when `element_id` is present, the compact label becomes `"<sheet>·P<page>·<element_id>"` (e.g. `"S-403·P8·HKP1"`), and `element_id` overrides the current `obj` chain.
- **Update `rewriteToRawInputAsk()`**: build `findPart` as `the ${noun} ${element_id}` when present; only fall back to `marked "<noun>"` when no ID exists.
- **Pass `element_id` through `linked_item`** so the QA card and overlay can render it as a badge.

### 3. `src/features/workflow-v2/stages/QAStage.tsx`

- Where the issue title / overlay label is rendered, prefer `issue.location?.element_id` as the primary chip (e.g. `[HKP1]` badge). Keep the existing label for context. No layout/overlay-lifecycle changes (preserves the dedicated overlay layer + stable PDF raster from the previous fix).

## Acceptance criteria

- Every unresolved-geometry question text contains the specific element ID when one exists in the OCR/description (HKP1, F12, W3, FW2, WF3, S-1, T.D.33, etc.).
- QA card title shows: `S-403 · P8 · HKP1` (or the best available object reference) — never just `Page 1`.
- When the row has no resolvable source page, the QA card does **not** show the cover sheet as evidence; it shows "source pending" instead of Page 1.
- Overlay/title chips display the element ID prominently.
- No re-render thrash: only label/text changes; PDF raster + overlay layer are untouched.
- Fallback chain when no ID exists is unchanged: detail → section → callout → grid → schedule → element noun.

## Files touched

- `supabase/functions/auto-estimate/index.ts` (regex, anchor meta, persistence, question text, source-file fallback)
- `src/features/workflow-v2/takeoff-data.ts` (regex, location shape, label builder, question rewriter)
- `src/features/workflow-v2/stages/QAStage.tsx` (small render tweak to surface `element_id`)

No DB migration required — `element_id` lives inside existing `assumptions_json` / `source_refs` JSON columns.
