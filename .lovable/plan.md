# Stage 03 Calibration — Verification & Minor Polish

## What already exists (verified in code)

**A. Loading reliability** — `CalibrationStage.tsx`
- `STEP_TIMEOUT_MS = 15000` per fetch via `timedFetch` + `AbortController`.
- 4 explicit steps: `index → revisions / drawings / files` (latter 3 in parallel via `Promise.allSettled`).
- Per-step pill (loading / done / error) with the exact error message and per-step Retry button + a global Retry. Loader never spins forever.

**B. Scale parser** — `src/features/workflow-v2/lib/scale-resolver.ts`
- Architectural (`1/8" = 1'-0"`) and engineering (`1:50`) scale parsing.
- `collectScaleCandidates` classifies each match as `sheet` / `detail` / `unknown` using surrounding context (`SCALE/SHEET/PLAN` vs `DETAIL/SECTION/ENLARGED/KEY PLAN`).
- Multiple competing sheet scales → `reviewState = "ambiguous"`, `reason = "multiple scales detected"`, `pixelsPerFoot = 0` (never silently picks one).
- Detail-only matches → `"detail scales found only"` (never accepted as primary).
- Fallback chain: title-block → grid-dimension (medium/high) → annotation → auto-dimension → known object, all attached with diagnostics.

**C. OCR strategy**
- `buildScaleSearchText` scans full text up to 24 000 chars, otherwise samples `start + middle + end` (8 KB each) — diagnostics record which segments were used.

**D. Manual calibration**
- `TwoPointCalModal` renders the PDF page via `PdfRenderer`, lets the user click two points, enter real-world feet, and computes `px/ft`. Result is saved as `source: "user", confidence: "user", method: "Two-point measurement"`, status `manual`. Available from every sheet row regardless of auto-detection state.

**E. Per-sheet status model**
- `ScaleStatus = "auto-detected" | "verified" | "manual" | "ambiguous" | "failed"` rendered as a pill.
- Reasons rendered below the row: `no scale text found`, `multiple scales detected`, `detail scales found only`, `OCR incomplete`, `metadata load failed` (the last is set automatically when the metadata fetches reject and the row is unresolved).

**F. UX flow**
- Load → discipline detection (`detectSheetDiscipline`) → auto scale → status pill → Accept / Measure / px-ft override → `Confirm calibration` button is disabled until every required (Structural + Architectural) row is resolved (`isResolved` = calibrated AND not `requiresReview`). Structural rows additionally require `confidence: high` and no detail-override conflicts.

**G. Structural safety**
- `requiresReview` forces "needs review" on Structural rows whose confidence is not `high` or that have detail overrides. Detail-only / multi-scale results never auto-promote.

**H. Diagnostics**
- Per-row `<details>` block prints decision, OCR length, scanned segments, matched sheet scales and matched detail scales. Console logs each step's elapsed ms and which step failed.

**Tests** — `src/test/scale-resolver.test.ts` covers: late-text scale, ambiguous multi-scale, detail-only, no-scale-text fallback.

## Conclusion

Every item in the request (A–H, including the manual two-point tool and per-sheet status) is already implemented. **No code changes are required to satisfy the success criteria.**

## Optional polish (only if you want me to apply)

1. **Per-step retry buttons** — today the warning-icon button retries all four steps; could wire each step icon to retry only that fetch.
2. **`metadata load failed` retry hint** — show a one-click "Retry metadata" inline on rows whose status is downgraded by a metadata reject.
3. **Cache signed URL in `TwoPointCalModal`** — currently re-requested every open; minor.
4. **Add unit test** for `TwoPointCalModal` math (px → ft → ppf).
5. **Surface `unmatchedTokens`** from `ocr-page-labels` inside the diagnostics `<details>` so estimators see why a footing/wall mark wasn't recognised on the same sheet they're calibrating.

Tell me which (if any) of 1–5 you want and I'll implement only those — otherwise Stage 03 is done.

## Risks remaining

- Auto-dimension fallback (assumes ANSI D + 96 DPI) can be off when sheets are exported at non-standard DPI; this is intentionally surfaced as `low` confidence and forces review on Structural sheets.
- `metadata load failed` is non-fatal: rows still load from `drawing_search_index`, but sheet numbers/discipline/file paths may be missing until the user retries.
- Two-point tool requires a `file_path` (PDF in `blueprints` bucket); for index rows without a linked document the modal degrades to "use the px/ft input instead".
