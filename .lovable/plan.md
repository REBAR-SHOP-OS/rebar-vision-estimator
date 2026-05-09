# Takeoff Canvas — Fix overlay + reclaim viewport

The Canvas view currently (a) draws polygons that don't appear because they aren't tied to the active sheet/page, (b) has a hard-to-see "active layer" state, and (c) wastes half the screen on chrome (260px Layers rail + 78vh image cap + workflow stage strip + app sidebar). All work stays in `src/components/takeoff-canvas/TakeoffCanvas.tsx` and the canvas branch of `TakeoffStage.tsx` / `ScopeStage.tsx`. No DB schema changes (the existing `takeoff_overlays` table already has `page_number`).

## 1. Overlay bug — target the right page/sheet

**Symptom:** Layers show `0 drawn` even after drawing; polygon disappears as soon as PDF renders page 1.

**Causes**
- `useEffect` that loads polygons keys on `page` but `page` defaults to `1` and only updates after `PdfRenderer` reports `pageNumber`. The save uses the same stale `page`, so polygons are written for page 1 even when a multi-sheet PDF is showing a different sheet.
- `takeoff_overlays` rows don't carry the file/sheet identifier, so loading the canvas with a different file shows old polygons.

**Fix (minimal patch)**
- Pass and store `file_path` (or `legacy_file_id` when available) on each overlay row by extending the `insert` payload with `source_file: filePath`. Add the same column to the `select` filter so polygons load only for the current sheet. (Column already exists in `takeoff_overlays` — if not, add it via a small additive migration with a nullable `source_file text` column. No data backfill needed.)
- Synchronise the persisted `page` with what `PdfRenderer` actually rendered: derive saves from a single `currentPage` state set inside `onRender`, so the first save matches the visible sheet.
- Re-fetch polygons whenever `signedUrl` or `currentPage` change (currently keyed only on `page`).

## 2. Make selection + drawing obvious

- Highlight the active layer with a solid swatch border + filled background (use `bg-primary/15` and a 2px ring) so it reads in dark mode.
- Auto-switch the tool to `polygon` the moment a layer is clicked (and back to `pan` after the polygon is committed) so users don't need to discover the keyboard shortcut.
- Show the active layer name + a "Click to add point · Double-click to close" hint inline at the top of the stage instead of only in the bottom status strip.
- Keep saved polygons clickable in any tool, but make them brighter (raise `fillOpacity` from 0.28 → 0.45 and stroke width from 0.003 → 0.005) so existing overlays are visible on dense drawings.

## 3. Reclaim space for the blueprint

In `TakeoffCanvas.tsx`:
- Drop the right `Layers` aside from 260px → collapsible 56px rail (icon-only swatches with a tooltip) and add a chevron to expand to a 220px panel on demand. Default state = collapsed for first paint.
- Remove the bottom status bar (move "tool / pts" into the floating tool palette tooltip and active-layer chip). Saves ~28px vertical.
- Replace the `max-h-[78vh]` cap on the `<img>` with `h-full w-full` inside a flex container so the sheet fills all remaining vertical/horizontal space.
- Remove the redundant top "Sheet … 1 / 18" bar and merge page nav into the tool palette as ◀ N/M ▶ buttons.

In the canvas branch of `TakeoffStage.tsx` (lines 689-712):
- Drop the `StageHeader` in canvas mode and render only a thin 32px top strip with the Table/Canvas toggle pinned right. The workflow stage strip on the left is already enough breadcrumb.

In `ScopeStage.tsx` canvas usage (around line 304):
- Same: collapse the methodology chips row into a single overflow chip (`Σ 5 steps`) when the viewport is narrower than 1100px so the canvas isn't shrunk.

The combined effect: the blueprint area gains roughly +260px horizontal and +60px vertical at default zoom, which is what the user is asking for.

## Files touched
- `src/components/takeoff-canvas/TakeoffCanvas.tsx` — overlay fix, selection UX, collapsible Layers rail, removed status bar, fill-area image.
- `src/features/workflow-v2/stages/TakeoffStage.tsx` — slimmer canvas-mode header (lines 689-712 only).
- `src/features/workflow-v2/stages/ScopeStage.tsx` — responsive methodology chips (lines 270-302 only).
- `supabase/migrations/<new>.sql` — only if `takeoff_overlays.source_file` doesn't exist; single `ALTER TABLE … ADD COLUMN source_file text;`.

No other files, no rewrites of working logic, no changes to estimation pipeline, segments table, or AppSidebar.

## Out of scope
- Touching `AppSidebar`/workflow stage rail — those are shared chrome used by every other stage; collapsing them belongs to a separate request.
- Pan/zoom gestures on the canvas (current Pan tool stays a no-op cursor change).
