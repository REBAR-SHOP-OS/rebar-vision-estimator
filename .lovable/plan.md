## Goal

When a sheet has no explicit scale ("SCALE: 1/8" = 1'-0"" or "1:50") anywhere on it, automatically calibrate by extracting any dimension/size annotation already on the drawing (e.g. `12'-6"`, `8'`, `150 mm`, `3000`) and inferring px/ft from it. Estimator never sees a "no scale" dead-end as long as the sheet contains at least one readable size.

## Scope (minimal)

Frontend / presentation only. Two files touched:

- `src/features/workflow-v2/lib/scale-resolver.ts` — add a text-only auto-dimension fallback.
- `src/features/workflow-v2/stages/CalibrationStage.tsx` — feed raw text through the new fallback and surface it in the row.

No DB, no edge functions, no schema, no other stages.

## Behavior

Resolver priority becomes:

1. Title-block scale text (high) — unchanged
2. Dimension annotations w/ measured pixels (medium) — unchanged
3. **NEW: Text-only auto-dimension fallback (low / `auto_dimension` source)** — scrape any `N'-N"`, `N'`, `N"`, or metric size from raw OCR text and convert to feet using a documented assumption (sheet rendered at 96 DPI on standard ANSI D paper width). Pick the median of all parsed sizes to stay robust against title-block junk.
4. Known-object fallback — unchanged
5. Existing low-confidence "SCALE keyword found" hit — unchanged

The new fallback only fires when layers 1–2 produced nothing usable, so high-confidence paths are never weakened.

## Technical details

`scale-resolver.ts`
- Add `"auto_dimension"` to `CalibrationSource`.
- Add `tryAutoDimensionFromText(rawText)`:
  - Reuse existing `parseImperialFeet` / metric parsing on each whitespace-split token.
  - Collect all positive feet values in plausible drawing range (0.5 ft ≤ x ≤ 200 ft).
  - If ≥1 found, take the median real-feet value `R` and assume the longest documented run on the sheet matches the drawable width of an ANSI D sheet at 96 DPI (3264 px ≈ 34 in). px/ft = `3264 / R` clamped to `[16, 384]`.
  - Return `{ source: "auto_dimension", pixelsPerFoot, confidence: "low", method: "Auto-inferred from N dimension annotation(s) — verify before takeoff" }`.
- In `resolveScale`, insert this layer between B and C and only when A and B failed.

`CalibrationStage.tsx`
- No UI restructure. Existing pill already shows `cal.confidence`, so auto-calibrated rows render as `low` with the explanatory `method` string already shown under the row.
- Gate logic stays the same: `isResolved` requires `confidence !== "low"`, so auto-calibrated sheets still need a one-click estimator confirmation (typing the value or accepting it via the existing px/ft input). This preserves the trust-first rule — we propose, estimator confirms.
- Add a tiny "Use auto value" button next to the px/ft input only when `cal.source === "auto_dimension"`; clicking it copies the auto px/ft into the override (which marks it `user` confidence and unblocks the gate). Button is the only new control.

## Out of scope

- Changing px/ft for already-resolved sheets.
- Touching takeoff math, edge functions, OCR pipeline, or DB.
- Auto-confirming the calibration gate without estimator action.

## Verification

- Sheet with explicit scale → unchanged behavior.
- Sheet with no scale but dimension text like `24'-0"` → row shows `low` pill, method "Auto-inferred from 1 dimension annotation(s)…", clicking "Use auto value" promotes to `user` and the gate unlocks.
- Sheet with no scale and no dimension text → unchanged "No scale text detected — enter px/ft manually".
