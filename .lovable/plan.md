## Goal

Make the calibration stage handle real commercial drawing sets (metric S-/A- series at 1:100, with detail callouts at 1:25 and N.T.S. zones) without manual estimator input whenever the sheet contains either:
- a stated metric ratio (1:50, 1:100, 1:200), or
- a known grid spacing dimension (e.g. "6133" between Grid 1–2, total length "49415"), or
- a per-detail scale bubble (e.g. "1:25" under a detail tag).

Trust-first rules stay intact: high-confidence hits unlock the gate automatically; low-confidence hits still require a one-click estimator confirmation.

## Scope (minimal — frontend only)

Two files touched, no DB / edge / OCR changes:

- `src/features/workflow-v2/lib/scale-resolver.ts` — extend resolver with metric ratio handling, grid-spacing inference, and a per-region detail-scale layer.
- `src/features/workflow-v2/stages/CalibrationStage.tsx` — surface the new sources in the row UI (badge + method text + "Use auto value" affordance already there) and add a small "Detail overrides" disclosure when per-detail scales are detected.

Existing `tryAutoDimensionFromText` and `getAuthoritativeCalibration` behavior preserved.

## Behavior

Resolver priority becomes:

1. **Title-block scale text** — unchanged, but `RATIO_RE` now recognizes any `1:N` (currently does), and we treat 1:50 / 1:100 / 1:200 / 1:25 as **high** confidence (today they already are; add an explicit metric-DPI calc path).
2. **Grid-spacing calibration (NEW, high)** — if rawText contains a recognizable grid label pattern (e.g. `Grid 1`, `①`, `A`–`B`) followed by a 4–5 digit metric value (`6133`, `49415`), and we have at least 2 such samples, derive px/ft from the median grid-span using the page's pixel width. Marked `source: "grid_dimension"`, confidence `high` when ≥3 samples agree within 5%, otherwise `medium`.
3. **Dimension annotations w/ measured pixels** — unchanged.
4. **Auto-dimension text fallback** — unchanged (existing `tryAutoDimensionFromText`).
5. **Known-object fallback** — unchanged.

**Per-detail overrides (NEW, parallel layer):**
- New `tryDetailScales(rawText)` returns a list of `{ detailTag, scale, pixelsPerFoot, confidence: "high" }` whenever the text matches a detail-bubble + scale pattern (e.g. `1/S-6.0  SCALE: 1:25`, `DETAIL A  1:25`, `N.T.S.`).
- Stored on the calibration row as `cal.detailOverrides: DetailOverride[]`. Sheet-level calibration still drives the gate; overrides are consumed downstream by takeoff measurements that fall inside the bubble's region (out of scope for this patch — we only surface and persist them).
- N.T.S. detail tags are recorded as `pixelsPerFoot: 0, confidence: "user"` so takeoff knows to require manual entry there.

## Technical details

`scale-resolver.ts`
- Add to `CalibrationSource`: `"grid_dimension"`.
- Add `DetailOverride { tag: string; scaleText: string; pixelsPerFoot: number; nts: boolean }` and optional `detailOverrides?: DetailOverride[]` on `Calibration`.
- New helper `parseMetricRatio(text)` returns `{ pixelsPerFoot }` from `1:N` using `(304.8 / N) * 3.7795` (already in `tryTitleBlockText`; extracted so grid-layer can reuse).
- New `tryGridDimension(rawText, pageWidthPx?)`:
  - Regex for grid tokens: `/\bGrid\s+([0-9A-Z]+)\b/gi` plus circled-digit unicode `①–⑳`.
  - For each adjacent pair, look for a 4–5 digit number within ±80 chars; collect `{ realMeters: n/1000, pair }`.
  - If the running total of consecutive grids matches a candidate "overall length" number in the text (within 5%), boost confidence to `high` and use overall-length-in-px ≈ `pageWidthPx * 0.85` (drawable area) if `pageWidthPx` provided, else fall back to ANSI-D 3264 px assumption.
  - Returns `{ source: "grid_dimension", pixelsPerFoot, confidence, method: "Grid spacing: 6133 mm between Grid 1–2 (×N samples)" }`.
- New `tryDetailScales(rawText)`:
  - Regex pairs: `/(\b\d+\/[A-Z]-?\d+(?:\.\d+)?)\b[^\n]{0,40}?(?:SCALE\s*[:=]?\s*)?(1\s*:\s*\d+|N\.?T\.?S\.?)/gi` and `/DETAIL\s+([A-Z0-9]+)[^\n]{0,40}?(1\s*:\s*\d+|N\.?T\.?S\.?)/gi`.
  - Map each to a `DetailOverride`. NTS → `nts: true, pixelsPerFoot: 0`.
- `resolveScale` order: A → grid → B → autoDimension → C; attach `detailOverrides` to whatever wins (parallel side-channel, doesn't change main pick).
- Pass optional `pageWidthPx?: number` through `SheetScaleInputs`.

`CalibrationStage.tsx`
- When loading sheets for resolution, pass the rendered page width (already available where the thumbnail/PDF page is known) into `resolveScale`.
- Row UI:
  - Add `grid_dimension` to the source pill mapping (label "Grid", same styling as `title_block`).
  - When `cal.detailOverrides?.length`, render a small collapsible "N detail scale(s) detected" row beneath the method text listing each `tag — scaleText` with an N.T.S. warning chip where applicable. No interaction beyond view in this patch.
- Gate logic unchanged: `grid_dimension` at `high`/`medium` unlocks; everything else still requires "Use auto value" or manual entry.

Out of scope:
- Applying detail-scale overrides to takeoff math (only persist+display here).
- Edge functions, OCR pipeline, DB schema.
- Auto-confirming low-confidence rows.

## Verification

- Sheet S-1.0 with `SCALE 1:100` text → high-confidence `title_block` pill, gate unlocks (existing behavior, regression check).
- Sheet with no scale text but text containing `Grid 1 ... 6133 ... Grid 2 ... 7500 ... Grid 3` and overall `49415` → `grid_dimension` pill, method `"Grid spacing: median 6133 mm (3 samples)"`, gate unlocks.
- S-6.0 details sheet with `1/S-6.0 SCALE: 1:25` and one `DETAIL B N.T.S.` → main calibration falls through to `auto_dimension` or `title_block`, plus a "2 detail scale(s) detected" disclosure showing `1/S-6.0 — 1:25` and `DETAIL B — N.T.S. ⚠`.
- Sheet with neither scale nor grids nor dimensions → unchanged "manual entry" state.
