## Issues

1. **Modal renders the wrong page** — In `TwoPointCalModal` (`src/features/workflow-v2/stages/CalibrationStage.tsx`), `<PdfRenderer>` is hard-coded to `currentPage={1}`, so every two-point measurement (Page 3, Page 4, Page 13, Page 16…) shows page 1 of the PDF.
2. **Cover sheets demand calibration they don't need** — Sheets like `S-0.0` (COVER SHEET / "SCALE = N.T.S") fail scale detection and block the calibration gate, even though no takeoff happens there.

## Fix

### 1. Render the correct page in the two-point modal
- Pass `currentPage={sheet.page_number ?? 1}` to `<PdfRenderer>`.
- Reset `rendered` and `points` whenever `sheet.id` (or `sheet.page_number`) changes so a previously-rendered page doesn't leak across openings.

### 2. Allow marking a sheet as "Not applicable" (cover / NTS)
- Add a per-sheet action `Mark as N/A` next to **Accept / Measure** in the row UI inside `DisciplineSection`.
- Store N/A sheet IDs in workflow local state: `state.local.calibrationNotApplicable: Record<string, true>`.
- A sheet flagged N/A:
  - is excluded from `gateRows` (does not block confirm),
  - renders with a muted `n/a` pill instead of `auto / failed / ambiguous`,
  - shows an `Undo` action to clear the flag.
- Auto-suggest N/A for obvious cover pages — do NOT silently apply, just pre-highlight the row and surface the chip. Heuristic helper `isLikelyCoverSheet(row)` near `requiresReview`:
  - `sheet_number` matches `/^[A-Z]{1,3}-?0\.0$/i` (e.g. `S-0.0`, `G0.0`), OR
  - `raw_text` (uppercased, first 800 chars) contains `COVER SHEET` or `COVER PAGE`, OR
  - `raw_text` contains `N\.?T\.?S\.?` AND no parseable scale was detected (`calibration?.pixelsPerFoot` falsy).

### 3. Gate / banner updates
- `gateRows` filter excludes N/A sheets before counting `gateResolved` / `verifiedCount` / `unresolvedRequired`.
- Bottom GateBanner copy unchanged; counts come from filtered `gateRows`.

## Out of scope
- No changes to scale resolver, OCR pipeline, or DB schema.
- No backend persistence of the N/A flag beyond the existing per-project `state.local` blob.
- No styling changes outside the new pill + button.

## Files touched
- `src/features/workflow-v2/stages/CalibrationStage.tsx` (only file)

## Verification
- Open Stage 03, click **Measure** on Page 3 / 4 / 13 / 16 → modal title and rendered page match.
- Cover sheet (`S-0.0`) shows a suggested **Mark as N/A** chip; clicking it removes the sheet from the blocking count and lets **Confirm calibration** enable when the rest are resolved.
- **Undo** restores the prior status.
