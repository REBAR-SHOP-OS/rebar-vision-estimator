## Goal

A single project bundles Architectural + Structural sheets. Rebar takeoff is driven by Structural only, so the calibration gate must require scales for Structural sheets, treat Arch as reference-only, and visually separate the two groups. "Structural wins" — when Arch and Structural overlap on the same area, Structural's calibration is the authoritative source for any downstream length math.

## Scope (what to build)

1. **Discipline-aware sheet rows in `CalibrationStage`**
   - When loading `drawing_search_index`, also pull each sheet's `document_versions.file_name` (or fall back to `logical_drawings.discipline` / `sheet_revisions.discipline` if available) and run `detectDiscipline()` from `src/lib/rebar-intake.ts`.
   - Tag every `SheetRow` with `discipline: "Structural" | "Architectural" | "Other"`.

2. **Two-section UI**
   - Render two collapsible groups:
     - **Structural — required for takeoff** (orange accent, sheets in this group must be resolved/overridden).
     - **Architectural — reference only** (muted, shown for context, no input required, optional override field still available but not gating).
   - Each group has its own header counts: `n confirmed / n total · avg confidence`.
   - "Other / Unknown" sheets fall under Architectural (reference-only) with a warning pill so the estimator can reclassify.

3. **Gate logic = Structural only**
   - `allConfirmable` becomes: every `Structural` sheet has `pixelsPerFoot > 0` and `confidence !== "low"`.
   - "Confirm calibration" button disabled when any Structural sheet is unresolved. Arch sheets are ignored by the gate.
   - GateBanner copy updated: "Resolve every Structural sheet …" + "Architectural sheets are reference only."
   - Empty case: if a project has zero Structural sheets, show a blocking notice ("No Structural sheets detected — reclassify a sheet or upload structural drawings before takeoff") instead of auto-passing the gate.

4. **"Structural wins" data contract**
   - Persist calibration in `state.local.calibration` keyed by `sheet_id` (already done) plus a new `state.local.calibrationPrimary` = `"structural"` constant for now (single-source-of-truth flag, future-proofs Arch overrides).
   - Add a small helper `getAuthoritativeCalibration(sheetId, allSheets, calibrations)` in `scale-resolver.ts`:
     - If the sheet is Structural → use its own calibration.
     - If the sheet is Architectural → fall back to the **nearest Structural sheet** (same page range/sheet number prefix, else first Structural in the project) so any future Arch-driven length still resolves through a Structural ppf.
   - Downstream (`TakeoffStage` quantities) keeps using its existing path; this helper is exported so future quantity logic and Outputs can call it without ambiguity.

5. **Reclassification affordance**
   - Each row gets a small `Discipline ▾` selector (Structural / Architectural) so the estimator can override the auto-detected discipline. Stored in `state.local.disciplineOverride: Record<sheetId, "Structural" | "Architectural">`.
   - Reclassifying a sheet to Structural immediately moves it into the gating section.

## Out of scope

- No DB schema changes. All discipline state lives in `state.local` for now (consistent with the current calibration storage).
- No changes to `TakeoffStage`, `QAStage`, `ConfirmStage`, `OutputsStage`, or the gate component itself — they keep reading `state.local.calibrationConfirmed`.
- No edge-function or OCR pipeline edits.
- Title-block / dimension scale resolver logic (`resolveScale`) is not modified.

## Files touched

- `src/features/workflow-v2/stages/CalibrationStage.tsx` — load discipline, group rows, gate on Structural only, add reclassify dropdown, copy updates.
- `src/features/workflow-v2/lib/scale-resolver.ts` — add `getAuthoritativeCalibration` helper + `Discipline` type export.
- (read-only) reuse `detectDiscipline` from `src/lib/rebar-intake.ts`.

## Verification

- Project with only Arch sheets → gate blocks with "No Structural sheets detected".
- Project with mixed sheets → only Structural rows are required; confirm button enables once Structural rows resolve.
- Reclassifying an Arch sheet to Structural moves it into the gating section and re-disables the button until resolved.
- `npx tsc --noEmit` clean; existing 34 vitest tests still pass (no test files modified).
