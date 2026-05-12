## Goal

Two small UX fixes to the Calibration stage (`src/features/workflow-v2/stages/CalibrationStage.tsx` only):

1. Treat info-only sheets (schedules, loading info, general notes) like cover sheets — eligible for **Mark N/A** so they don't block the calibration gate.
2. Let the two-point measurement modal accept the known distance in **ft, in, m, cm, or mm** instead of ft only.

No backend, schema, or scale-resolver changes.

---

## 1. Expand `isLikelyCoverSheet` → suggest N/A for info-only sheets

Extend the existing heuristic so the same "looks like cover → Mark N/A" affordance covers schedule / notes / legend pages. Match when **any** of these are true:

- Existing rules (sheet number `*-0.0`, `COVER SHEET/PAGE`, NTS-only with no scale).
- Sheet number prefix `G-` / `GN-` (general notes) when no parseable scale.
- Raw text (first ~800 chars, uppercased) contains one of: `LOADING INFORMATION`, `GENERAL NOTES`, `DRAWING INDEX`, `DRAWING LIST`, `LEGEND`, `ABBREVIATIONS`, `BAR SCHEDULE`, `BEAM SCHEDULE`, `COLUMN SCHEDULE`, `REBAR DEVELOPMENT SCHEDULE`, `STEEL SCHEDULE`, `LINTEL SCHEDULE` — AND the sheet has no parseable scale (`!row.calibration || row.calibration.pixelsPerFoot <= 0`).

Rename helper to `isLikelyNonScaledSheet` (keep call sites working) and update the existing `"looks like cover"` warning pill copy to `"info-only sheet"` when triggered by a schedule/notes match (use a small enum returned from the helper, or a second helper `getNonScaledReason()` returning `"cover" | "schedule" | "notes" | null`). Keep cover wording for cover matches.

No behavior change for sheets that already have a confident scale.

## 2. Multi-unit input in `TwoPointCalModal`

Replace the ft-only input with a number input + a unit `<Select>` (units: `ft`, `in`, `m`, `cm`, `mm`).

- Add `const [unit, setUnit] = useState<"ft"|"in"|"m"|"cm"|"mm">("ft")`.
- Reset `unit` alongside `realDist`/`points` in the existing `useEffect` keyed on `sheet.id` / `pageNumber`.
- Compute feet from the entered value:
  - `ft`: value
  - `in`: value / 12
  - `m`: value * 3.28084
  - `cm`: value * 0.0328084
  - `mm`: value * 0.00328084
- Use the converted feet value in the existing `computedPpf = pixelDist / feet` calculation.
- Update the label `Known distance (ft)` → `Known distance` and place the Select to the right of the number input. Keep the `= XX.XX px/ft` readout (always reported in px/ft because that's what downstream code consumes).
- Placeholder adapts to unit (e.g. `e.g. 10` for ft/m, `e.g. 120` for in/cm, `e.g. 3000` for mm).

Use the existing shadcn `Select` (already imported in the file) with the project's standard sentinel pattern only if needed; otherwise plain `<select>` styled like surrounding controls is fine to keep the diff minimal.

## Files touched

- `src/features/workflow-v2/stages/CalibrationStage.tsx` (only file)

## Verification

- A sheet whose first page is the `LOADING INFORMATION / STEEL BEAM SCHEDULE / REBAR DEVELOPMENT SCHEDULE` layout (matches uploaded image) shows the `Mark N/A` chip with reason "info-only sheet" and stops blocking the gate when applied.
- Cover sheets still show the existing "looks like cover" wording.
- Two-point modal: pick a 3000 mm dimension on a sheet → enter `3000`, choose `mm` → `computedPpf` matches `pixelDist / (3000 * 0.00328084)` and the Apply button reports the same px/ft as before for the equivalent ft input.
- No regressions in `gateRows` counts; sheets already verified are unaffected.
