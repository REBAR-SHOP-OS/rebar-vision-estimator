## Goal

Three changes, scoped to keep risk low:

1. Delete the Legacy workspace entry-points (route, page, sidebar link).
2. Apply the Stitch "Industrial Precision" look (orange `#a43800` primary, Hanken Grotesk / Inter / JetBrains Mono, bold borders, no shadows) to the dashboard shell.
3. Insert a real **Scale Calibration** stage in the V2 workflow, before Takeoff, that gates downstream quantities until calibration confidence is acceptable.

No backend rewrites of working extraction. Calibration is additive — it stores per-sheet calibration and references it from segments at read time.

---

## Part 1 — Remove Legacy Workspace

Files:
- `src/App.tsx` — drop the `LegacyProjectWorkspace` lazy import + all 8 `legacy/project/:id*` routes.
- `src/components/layout/AppSidebar.tsx` — drop the "Legacy View" `NavLink` (lines ~113–120) and the `Settings` import if unused elsewhere.
- `src/pages/legacy/LegacyProjectWorkspace.tsx` — delete the file.
- `src/pages/legacy/` — delete the empty folder.

No DB or schema changes. No imports of `LegacyProjectWorkspace` exist outside these files (verified via ripgrep).

---

## Part 2 — Industrial Precision restyle (dashboard only)

Scope: `src/pages/Dashboard.tsx` and `src/components/dashboard/RebarForgeDashboard.tsx` (the page rendered at `/app`). Keep all logic, data fetching, and state. Restyle only.

### Design tokens (added to `src/index.css` + `tailwind.config.ts`)

Add a new semantic palette under HSL tokens, scoped so existing screens are not broken:

```text
--industrial-surface:        25 100% 98%   (#fff8f6)
--industrial-surface-low:    22 100% 96%
--industrial-surface-high:   16 80% 92%
--industrial-on-surface:     16 35% 12%
--industrial-on-variant:     17 25% 29%
--industrial-outline:        17 18% 48%
--industrial-outline-variant:17 50% 80%
--industrial-primary:        20 100% 32%   (#a43800)
--industrial-primary-container: 22 100% 40%
--industrial-secondary:      217 33% 41%
--industrial-tertiary:       211 100% 35%
```

Map them as Tailwind extension keys (`industrial-surface`, `industrial-primary`, …) so we don't collide with the existing `primary`, `background`, etc. used by every other screen.

Add font families to `tailwind.config.ts` (`hanken`, `inter`, `mono-jet`) and load Hanken Grotesk + JetBrains Mono in `index.html` (Inter is already loaded). Add `font-display`, `font-data-label`, `font-data-value` utility classes via `@layer utilities` in `index.css`.

### Dashboard layout

Rebuild the single `RebarForgeDashboard` page using the Stitch markup as the visual reference:

- Top metric strip: 3 cards (Active Projects / Estimated Tonnage / Accuracy) — bordered, 1px outline-variant, no rounded corners, display-lg numerals in Hanken, mono unit suffix.
- Two-column grid: "Recent Projects" cards (left, 2/3) + "Active Logs" table (right, 1/3) with status dot column.
- Bento bottom row: "Automated Blueprint Intelligence" with the takeoff grid background + "Ready for Procurement" orange callout.
- Floating `+` FAB in lower-right (route to New Estimate).

Replace shadows with bold borders. Use `font-data-value` mono for tonnages, line-item qty, and rebar marks. Replace existing teal accents with `industrial-primary`. The sidebar (`AppSidebar.tsx`) is **not** restyled in this pass — keeps risk minimal — but the "Legacy View" link is removed.

This restyle does **not** touch `WorkflowShell` or any stage components.

---

## Part 3 — Scale Calibration stage

### Workflow change

Update `src/features/workflow-v2/types.ts`:

```text
files → scope → calibration → takeoff → qa → assistant → confirm → outputs
```

Add `StageKey = "calibration"`, insert at index 3, renumber subsequent stages. Update `STAGES` array.

`useWorkflowState.ts` — add `calibrationConfirmed: boolean` + `calibration: Record<sheetId, Calibration>` to state. Persist alongside existing flags.

### New stage component

`src/features/workflow-v2/stages/CalibrationStage.tsx`:

- Lists every sheet for the project (read from `rebar.drawing_sheets` via existing `loadWorkspaceProject` data).
- For each sheet, runs the layered scale resolver and shows the result with a confidence badge:
  - **Layer A — Title-block / viewport scale text** (regex over OCR text already in `drawing_search_index.raw_text`): patterns `1/8" = 1'-0"`, `1/4"=1'`, `1:50`, `SCALE: NTS`, etc. Confidence high if exact match.
  - **Layer B — Dimension annotation** (e.g. `12'-6"`) cross-referenced with the geometry of the closest dimension line in the page rasters → derive `pixels_per_foot`. Confidence medium.
  - **Layer C — Known-object fallback** (door = 36", parking stall = 9' if labeled). Confidence low.
- Estimator can override (input field with unit `px / ft` or pick a scale from a dropdown). Override → confidence = `user`.
- "Confirm calibration" button per sheet. Project-level Continue button is **disabled** until every non-skipped sheet has `confidence ∈ {user, high, medium}`.

### Data model

New table `rebar.sheet_calibrations`:

```text
id uuid pk
sheet_id uuid fk → rebar.drawing_sheets
project_id uuid fk
source         text    -- 'title_block' | 'dimension' | 'known_object' | 'user'
scale_text     text    -- e.g. '1/8" = 1'-0"'
pixels_per_foot numeric not null
confidence     text    -- 'high' | 'medium' | 'low' | 'user'
method         text    -- short description of how it was derived
notes          text
confirmed_by   uuid
confirmed_at   timestamptz
created_at, updated_at
unique(sheet_id)
```

RLS: project-scoped via existing project membership pattern.

`rebar.takeoff_items` — add nullable columns:
- `pixel_length numeric`
- `pixel_geometry jsonb`
- `calibration_id uuid → rebar.sheet_calibrations`
- `real_length_ft numeric` (computed at write time as `pixel_length / pixels_per_foot`)

Existing rows stay valid (all new columns nullable). Recalculation when calibration changes is a single UPDATE keyed by `calibration_id` — no re-detection needed.

### Gating

- `TakeoffStage`, `QAStage`, `OutputsStage`, `ConfirmStage` — add a `GateBanner` (already used by `OutputsStage`) when `state.calibrationConfirmed` is false:
  - Tone: `blocked`
  - Title: "Calibration required"
  - Message: "Confirm sheet scale in Stage 03 before takeoff quantities can be trusted."
- Export gate (`src/lib/verified-estimate/export-gate.ts`) — add a check: refuse to export if any included `takeoff_items.calibration_id` is null **or** its calibration has `confidence = 'low'` and is unconfirmed.

### Resolver code (frontend, deterministic)

New `src/features/workflow-v2/lib/scale-resolver.ts`:

```text
type Calibration = {
  source: 'title_block'|'dimension'|'known_object'|'user';
  scaleText?: string;
  pixelsPerFoot: number;
  confidence: 'high'|'medium'|'low'|'user';
  method: string;
};

resolveScale(sheet): Calibration | null
  -> tryTitleBlockText(rawText)
  -> tryDimensionAnnotation(rawText, geometry)
  -> tryKnownObject(detections)
  -> null
```

Pure functions, fully unit-testable. Add tests in `src/test/scale-resolver.test.ts` covering the three layers + ambiguous text.

---

## Out of scope (intentionally)

- No change to `WorkflowShell` rendering logic except the new stage entry.
- No edits to `populate-search-index`, `analyze-blueprint`, OCR pipeline, or any other edge function.
- No restyle of stages, chat, sidebar, auth, marketing pages.
- No touch to `verified-estimate` persistence beyond the export-gate check.

---

## Verification

- `npm run lint` and `npm run test` (existing 34 tests must still pass).
- New Vitest file `scale-resolver.test.ts` with at least 6 cases.
- Manual: navigate to `/app/legacy/...` → 404. Dashboard at `/app` shows new orange industrial layout. Open a project → workflow shows 8 stages including "Calibration" between Scope and Takeoff. With no confirmed calibration, Takeoff/QA/Outputs show the blocked banner.
