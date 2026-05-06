# Manual-Only Authority Enforcement — Patch Plan

Goal: Make `Manual-Standard-Practice-2018` (uploaded into Brain) the sole assumption authority for the takeoff, eliminate hardcoded fallback math, correct source priority (shop > structural > arch context-only), and stamp every estimate row with citation + per-row provenance.

Minimal-diff, file-by-file. No refactors outside what's listed.

---

## 1. Brain ingestion — extract text at upload time

File: `src/components/chat/BrainKnowledgeDialog.tsx`

Currently uploaded files become `agent_knowledge` rows with `type: "file"`, `file_path`, no `content`. Auto-estimate only reads `title, content`, so the manual is invisible at runtime.

Patch (file upload handler around lines 128–160):
- After successful upload to `blueprints` storage, parse the PDF text in-browser using existing `pdfjs-dist` (already used elsewhere in project — confirm via `rg "pdfjs"`).
- Concatenate page text (cap ~500KB) into `content`.
- Insert row with `type: "file"`, `file_path`, AND populated `content`.
- Add a small badge in the file list when `content` is empty (so legacy uploads can be re-ingested via a "Re-parse" button calling the same extractor).

No schema change needed (`agent_knowledge.content` already exists).

---

## 2. Remove fallback assumptions in auto-estimate

File: `supabase/functions/auto-estimate/index.ts`

Targeted edits only:

**a. Delete hardcoded lap fallback (lines ~43, ~173, ~179)**
- Remove `lapMmFor()` helper.
- Replace `graph.lapTable.get(sizeKey(size)) ?? lapMmFor(size)` with manual lookup; if the manual provides no lap for that size → push `unresolved_reference: "lap length per Manual §X"` and mark the row `UNRESOLVED_GEOMETRY` (do not compute `barLenMm`).

**b. Delete the "typical construction practice" prompt fallback (line ~410)**
- Replace the `else` branch with a hard refusal directive:  
  `No drawing text available — DO NOT estimate. Return empty items[] with blocker reason "NO_DRAWING_TEXT".`

**c. Add manual-required gate (before the OpenAI call, ~line 250)**
- Fetch `agent_knowledge` rows where `title ILIKE '%manual%standard%practice%2018%'` AND `content IS NOT NULL AND length(content) > 1000`.
- If none found → return 200 with `{ items: [], blocked: true, reason: "MANUAL_NOT_LOADED" }`. Caller (TakeoffStage) already shows blockers.

**d. Inject manual into prompt as the only assumption authority**
- Add a `=== ASSUMPTION AUTHORITY (Manual-Standard-Practice-2018) ===` section.
- System rule: "Every assumption (lap, splice, hook, bend, mass, mesh) MUST cite a section/page from this manual. If the manual does not cover it, set the field UNRESOLVED. NEVER invent."

---

## 3. Correct source priority for production rebar

File: `supabase/functions/auto-estimate/index.ts` (prompt + file selection ~lines 365–410, 565–590)

- Detect file role from `file_name` / `file_type`: `shop` (SD\*, "shop"), `structural` (S\*, "struct"), `architectural` (A\*).
- Build `drawingTextContext` in priority order: shop → structural. Mark each block with header `[SHOP DRAWING — PRIMARY]`, `[STRUCTURAL — SECONDARY VERIFICATION]`.
- Exclude architectural OCR text from the takeoff prompt (keep only as titles in a `[CONTEXT ONLY — DO NOT QUANTIFY FROM]` footer).
- Update prompt rule: "Quantities come from SHOP DRAWINGS first. Use STRUCTURAL only to fill gaps or verify. NEVER derive quantity from architectural sheets."

---

## 4. Per-row provenance + citation fields

File: `supabase/functions/auto-estimate/index.ts` (insert payload ~lines 571–630)

- Stop using one batch `sourceFileId`. Instead require the model to return `source_sheet` (e.g. `SD-06`) and `source_excerpt` per item; map back to the file id via the OCR origin index already built earlier.
- Extend `assumptions_json` with:
  ```
  {
    authority_document: "Manual-Standard-Practice-2018",
    authority_section: <string|null>,
    authority_page: <number|null>,
    authority_quote: <string|null>,
    assumption_rule_id: <string|null>
  }
  ```
- If any assumption used but citation missing → mark row `status: "unresolved"` and add to `validation_issues` with `issue_type: "missing_citation"`.

No DB migration required — `assumptions_json` and `source_file_id` columns already exist on `estimate_items`.

---

## 5. Block unresolved rows from contaminating "near-final" estimate

File: `src/features/workflow-v2/stages/TakeoffStage.tsx`

Small UI/logic patch:
- When computing the headline totals (weight / cost) at the top of the stage, exclude rows where `status === "unresolved"` OR `assumptions_json.authority_document` is missing.
- Show a banner: "N rows blocked: missing manual citation or unresolved geometry. Resolve before quoting."
- Disable the "Approve / Send to Quote" CTA while blocked count > 0.

---

## Files touched (6 edits, no new files, no migrations)

```
src/components/chat/BrainKnowledgeDialog.tsx     — PDF text extraction on upload + Re-parse button
supabase/functions/auto-estimate/index.ts        — remove fallbacks, manual gate, source priority, per-row provenance, citations
src/features/workflow-v2/stages/TakeoffStage.tsx — exclude unresolved from totals, gate Approve CTA
```

## Out of scope (intentionally)

- No changes to `auto-bar-schedule` (separate path; can mirror later if needed).
- No DB schema changes.
- No refactor of OCR pipeline.
- No removal of `bar mass` / `mesh weight` reference tables (treated as fixed reference data per your spec).

## Validation after patch

1. Upload `Manual-Standard-Practice-2018.pdf` to Brain → confirm `agent_knowledge.content` populated.
2. Run takeoff with manual present → rows include `authority_section` citations.
3. Delete manual → re-run → engine returns `MANUAL_NOT_LOADED` blocker, no rows.
4. Run takeoff with only architectural PDFs → empty items, blocker `NO_SHOP_OR_STRUCTURAL_SOURCE`.
5. Run takeoff where lap not in manual → row marked `UNRESOLVED`, no fabricated `40*db`.


---
Status: implemented 2026-05-06T20:20Z
