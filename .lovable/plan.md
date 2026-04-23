

# Make AI Visual Draft Look Like a Candidate, Not an Issued Drawing

The recent PDF still looks too much like a real shop drawing because two things bleed issued-drawing semantics into AI mode:

1. The **HTML wrapper** in `OutputsTab.tsx` still uses fields like `DRAWING NO.`, formal sheet numbers, and a thin "AI CHANGE CANDIDATE" chip.
2. The **AI image prompt** in `draft-shop-drawing-ai` lets the model draw REV triangles, revision clouds, "REV. 1", "DETAILER / CHECKER" title blocks, and confident bar lists like `C1 32 - 20M x 4500`.

We fix both layers, plus tighten the pre-export validator. No new tables. No new pages. Three files touched.

## What changes

### 1. Reframe the AI wrapper HTML — `src/components/workspace/OutputsTab.tsx`

Inside `handleAiVisualDraft`, replace the title block + chrome around each AI image:

- **Sheet ID**: `SD-AI-01` → `AI-CANDIDATE-01` (kills the "real drawing number" association).
- **Title block**: replace single `DRAWING NO.` cell with a 4-cell **AI candidate header**:
  - `STATUS: UNVERIFIED — AI CANDIDATE` (red pill)
  - `GENERATED: <ISO date>`
  - `SOURCE: Verified Estimate v<n>`
  - `CONFIDENCE: <%>` (from canonical estimate)
- **Status pill**: bold red `UNVERIFIED` chip in title-block position where issued sheets show "ISSUED FOR CONSTRUCTION".
- **Watermark**: keep diagonal `AI VISUAL DRAFT — NOT FOR FABRICATION`, but add a second smaller diagonal stamp `CANDIDATE — NO FORMAL REVISION`.
- **Sheet frame**: switch from solid amber border to **dashed amber** + diagonal hatch in the corner — visually unmistakable as draft.
- **Footer**: add explicit line: *"Marks, quantities, and changes shown are AI suggestions. None are tied to a controlled revision. Use the Review Draft export for reviewer workflow, the Issued export for fabrication."*
- **Per-image disclaimer band**: directly below each AI image, render an **amber strip** that says: *"All callouts, bar marks, and dimensions in this image are AI-generated and unverified. Treat as sketch, not as fact."* This addresses the "exact-looking bar list" trust gap without requiring deterministic match data we don't have yet.

### 2. Constrain the AI image prompt — `supabase/functions/draft-shop-drawing-ai/index.ts`

Update the system/user prompt sent to the image model so it stops drawing issued-drawing semantics:

- **Forbid**: revision triangles (`△ 1`), revision clouds, the literal string `REV`, `REV.`, `R0`/`R1`, `DETAILER`, `CHECKER`, `CHECKED`, `APPROVED`, `ISSUED`, formal title blocks.
- **Forbid**: rendering exact bar quantity tables (e.g., `C1 32 - 20M x 4500`). Allowed: schematic shape, generic mark labels (`C1`, `T1`) without quantity-length triplets.
- **Replace** "revision cloud" instruction with: *draw a dashed orange "Suggested change" balloon labeled `Candidate #N` for any change callout*.
- **Replace** "REV" badge instruction with: *label as `AI Note` only*.
- **Add**: every change callout must include the word `CANDIDATE` and a number, never a revision letter.

This is the only place that stops the model from generating the offending pixels. Wrapper HTML alone can't hide what the image itself shows.

### 3. Harden the pre-export validator — `src/lib/shop-drawing/validate-metadata.ts`

Extend `validateDrawingMetadata`:

- **Spelling normalizer**: add a `normalizeProjectName` helper that auto-corrects common drafting typos (`Architectral` → `Architectural`, `Stuctural` → `Structural`, `Mechnical` → `Mechanical`). Returns the corrected string + a `warning` issue noting the auto-fix. Called from `OutputsTab.handleAiVisualDraft` before the AI prompt is built, so the corrected name flows into the image prompt and the wrapper HTML.
- **Required-field check for `ai_draft`**: also require `confidenceSource` (i.e., must have a current verified estimate). If missing, block export with a clear message — this is already partly enforced but currently allows export when `ver` is non-blocked regardless of confidence presence.
- **Discipline whitelist already exists** — extend warning to a hard error when the value is a known typo (`Architectral`, `Stuctural`, etc.).

### 4. Title-block field schema is mode-aware (already half-done)

The wrapper in `OutputsTab` is the only place rendering the AI title block, so the change in step 1 is sufficient — no shared template to refactor. The deterministic `shop-drawing-template.ts` (used by the other Render menu items) already keeps the `DETAILER / CHECKER / DATE / REV` fields, which is correct for review/issued exports. We do **not** touch that template.

## Files changed

| File | Change | LOC |
|---|---|---|
| `src/components/workspace/OutputsTab.tsx` | Rewrite the title-block, watermark, footer, and per-image disclaimer in `handleAiVisualDraft`'s inline HTML; call `normalizeProjectName` before building the prompt; switch sheet ID from `SD-AI-NN` to `AI-CANDIDATE-NN` | ~80 lines edited |
| `supabase/functions/draft-shop-drawing-ai/index.ts` | Update prompt to forbid REV/title-block/exact-quantity rendering and require `Candidate #N` language | ~30 lines edited |
| `src/lib/shop-drawing/validate-metadata.ts` | Add `normalizeProjectName` exporter, hard-error on known typos, require verified estimate confidence | ~40 lines added |

No DB migration. No changes to the deterministic template. No changes to OutputsTab capture pipeline (already fixed for blank PDF).

## What this delivers against the user's P0 list

- **P0.1 Kill formal revision behavior in AI mode** → prompt forbids REV/△/clouds; wrapper drops `DRAWING NO.` and replaces with `STATUS: UNVERIFIED`.
- **P0.2 Mark bar lists as unverified** → prompt forbids exact `mark — qty — size — length` triplets in the image; per-image amber strip in the wrapper labels everything as unverified.
- **P0.3 Replace issued-style title block fields** → wrapper switches to Status / Generated / Source / Confidence.
- **P0.4 Fix naming/metadata validation** → `normalizeProjectName` auto-corrects "Architectral" before the prompt sees it; validator hard-errors on the typo so it can never reach an export again.

## Out of scope (P1/P2 — flagged for follow-up)

- Provenance + deterministic-match badge per AI callout (P1) — needs a new `ai_callout_provenance` table; will scope as a separate plan.
- Full split into AI Preview / Review Draft / Issued export pipelines (P2) — already partially modeled by `shop_drawings.drawing_mode` + `export_class`; needs UI mode-switcher and a real diff engine, also a separate plan.

