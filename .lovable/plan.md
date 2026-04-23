

# Redesign AI Candidate Sheet — Drawing-First Layout

The current export uses ~28% of the sheet height for header/legend/footer chrome and renders the AI image with `object-fit: contain` inside a wide drawable cell, which leaves huge empty bands on either side when the image is portrait or square. Result: a tiny sketch floating in a big amber card.

The fix is one file, one inline `<style>` block, one HTML structure tweak. No new files, no schema changes.

## File touched

`src/components/workspace/OutputsTab.tsx` — only the inline HTML/CSS inside `handleAiVisualDraft` (~lines 510–626). Nothing else changes.

## Layout changes

### 1. Sheet zone re-budget (sheet-first composition)

Switch the `.frame` CSS grid from four rows to three, merging legend into the footer band, and slimming the header. Target zones on a 24×18 sheet:

| Zone | Old | New | % of 18in |
|---|---|---|---|
| Header band | 1.0in | **1.1in** | ~6% |
| Drawable viewport | ~13.0in | **15.1in** | ~84% (was ~73%) |
| Footer + legend (merged) | 1.9in | **1.8in** | ~10% |
| Right metadata rail | 2.5in (12% of 24) | **2.9in** (12%) | unchanged ratio |

New grid:
```text
grid-template-columns: 1fr 2.9in;
grid-template-rows: 1.1in 1fr 1.8in;
grid-template-areas:
  "header   title"
  "drawable title"
  "footer   title";
```
The legend moves *inside* `.zone-footer` as a horizontal compact strip on the left, with the safety warning on the right — one band, one row, ~1.8in tall instead of 1.9in stacked.

### 2. Drawable viewport — fill, don't float

Replace the constrained image rule:
- Drop `max-height: calc(100% - 0.6in)` and `max-width: 100%`.
- Use `width: 100%; height: 100%; object-fit: contain;` on `.sheet-image` so it scales up to whichever sheet axis runs out first while preserving aspect ratio.
- Move the unverified band out of the drawable flex column and into an **absolute-positioned overlay** at the bottom of `.zone-drawable` (15px tall, semi-opaque amber bar) so it never steals image space.
- Keep the 0.5in dot grid background (CAD paper feel) and the dashed amber image border.

### 3. Right metadata rail — denser

Same field set you listed (Sheet, Sheet Size, Scale, Generated, Source, Confidence, Deterministic Match, Review Status, Pending, Caption) but:
- Cell padding `5px 8px` → `4px 7px`.
- `gap: 0.08in` → `0.05in`.
- Add new `SCALE` cell with value `Schematic — N.T.S.` and a `PENDING` cell that shows whatever placeholder the rail currently lacks (issue count).
- Default placeholders rendered visibly:
  - `Confidence: Pending` when null (was `—`)
  - `Deterministic Match: Pending` (was `NOT VERIFIED`, kept red)
  - `Review Status: Unreviewed` (was `PENDING`, kept red)
- Caption cell uses remaining vertical space (`flex: 1`), 3-line clamp.

### 4. Footer/legend band — single horizontal strip

```text
┌────────────────────────────────────┬──────────────────────────────┐
│ LEGEND  ▣ Candidate  ▣ AI Note      │ Marks, quantities, and       │
│         ▣ Unverified ▣ Source ref    │ changes shown are AI         │
│                                     │ suggestions. Not for fab.    │
└────────────────────────────────────┴──────────────────────────────┘
```
- 1.8in tall, two columns (`1fr 1.4fr`), 11px text, all four legend swatches inline on one row.
- Removes the duplicated "no formal revisions" note (already in title-strip pill).

### 5. Header band — tighter

- Reduce vertical padding `0.15in 0.25in` → `0.1in 0.25in`.
- Brand logo `max-height: 0.7in` → `0.85in` (uses the slightly taller header).
- Project / segment text unchanged.
- Red `UNVERIFIED — AI CANDIDATE` pill stays right-aligned.

### 6. Watermarks — keep, reposition

Diagonal `AI VISUAL DRAFT — NOT FOR FABRICATION` and sub-stamp `CANDIDATE — NO FORMAL REVISION` stay full-sheet, centered. Corner amber hatch stays. Opacity unchanged.

### 7. Multi-sheet split (already in place)

Each AI image is already its own `<section class="sheet">` with `page-break-after: always`. The layout-engine "split, never shrink" rule is preserved — no change needed. If the new larger viewport still can't render an image at readable size for an exotic aspect ratio, the existing split-per-segment behavior already produces a fresh sheet.

## What we deliberately do NOT change

- AI prompt in `draft-shop-drawing-ai/index.ts` (Phase 2 already constrained it).
- `validate-metadata.ts` (Phase 1 already hardened it).
- `renderHtmlToPdf` and the ARCH C 24×18 sheet size (already real drawing-sheet sizing).
- `shop_drawings` insert / `export_jobs` insert (audit trail intact).
- Review Draft and Issued exports — out of scope for this patch.

## Acceptance check (visual QA after build)

1. Render AI Visual Draft on this project.
2. Open the resulting PDF — image should now occupy the full center band of each sheet, edge-to-edge horizontally inside the dashed amber image border.
3. Right rail visibly shorter / denser, no large empty padding.
4. Footer is a single horizontal strip, no stacked legend block above it.
5. Red `UNVERIFIED — AI CANDIDATE` pill, dashed amber border, watermarks, corner hatch all still present and unmistakable.
6. Sheet still prints at exactly 24×18 inches (verified via `pdfinfo` — should report `1728 x 1296 pts`).

## LOC estimate

~70 lines edited inside one `<style>` block + ~15 lines of HTML restructure inside the `sheets.map()` template literal. No other files. No DB. No edge function changes.

