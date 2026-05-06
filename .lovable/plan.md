## Problem

The Linked Source Review pane on the QA stage now shows the linked PDF, but it renders the **whole sheet** with no location pin. The reference UI you sent shows the exact callout zoomed in with a marker, plus Change/Impact/Evidence/Action tabs. Two gaps to close:

1. **Data**: `validation_issues.source_refs` only stores `{ estimate_item_id, missing }` — no `page_number`, no `bbox`. Without coords we cannot pinpoint anything.
2. **UI**: the right pane renders a flat full-page image, no zoom-to-region, no marker, no tabs.

## Plan

### 1. Capture location at issue creation (source-of-truth fix)

Edge function `supabase/functions/auto-estimate/index.ts` is where `validation_issues` rows are created. When inserting an `unresolved_geometry` issue, also persist (best-effort, optional) on `source_refs[0]`:

- `page_number` (int) — taken from the OCR token / element that triggered the issue
- `bbox` (`[x1,y1,x2,y2]` in source-page pixel space) — same source as `BlueprintViewer` overlays
- `image_size` (`{w,h}`) — original page pixel size used for normalization

Fallbacks (in order): bbox already on the OCR element → page-level bbox (full sheet) → omit (UI degrades to a centered marker on the page).

No DB migration needed — `source_refs` is `jsonb`. Existing rows keep working.

### 2. Backfill marker for existing rows (no DB writes)

In the QA loader (`src/features/workflow-v2/takeoff-data.ts`), when reading `validation_issues`, also fetch the matching `estimate_items.assumptions_json` for the referenced `estimate_item_id` and pull any `bbox` / `page_number` saved there by previous runs. Surface as `sel.locator = { page, bbox, imageSize }`.

### 3. Pinpoint viewer (UI rewrite of the right pane in `QAStage.tsx`)

Replace today's full-page `<img>` with a **focused crop**:

```text
┌──────────────────────────────────┐
│  CHANGE  IMPACT  EVIDENCE  ACTION│   ← tabs
├──────────────────────────────────┤
│  ┌────────────────────────────┐  │
│  │  zoomed PDF region         │  │   ← PdfRenderer renders page,
│  │      ┌───┐                 │  │     parent <div> applies
│  │      │ ● │  ← pulsing mark │  │     transform: translate+scale
│  │      └───┘                 │  │     so bbox center is centered
│  │                            │  │     at ~2x zoom.
│  └────────────────────────────┘  │
│  Drawing: S-5.0 · Page 3/12      │
│  [Open full sheet] [Show context]│
└──────────────────────────────────┘
```

Behavior:

- Reuse existing `PdfRenderer` to rasterize only the relevant `page_number` at scale 2.
- Compute a CSS `transform` on the image wrapper so the bbox center sits in the middle of the panel and the bbox occupies ~60% of the panel's shorter side. If no bbox, render the full page with a centered pin.
- Overlay a pulsing marker (`<div class="absolute animate-ping">`) at the bbox center using the same normalized coordinates pattern as `DrawingOverlay.tsx`.
- "Show context" toggles between the tight crop and the full page (both with the marker).
- "Open full sheet" opens the existing signed URL in a new tab (already wired).

### 4. Tabs (Change / Impact / Evidence / Action)

Add a small tab bar above the viewer using existing shadcn `Tabs`:

- **Change**: title, severity pill, `description`, and the `missing[]` list from `source_refs` rendered as chips.
- **Impact**: linked `estimate_item` row preview (size, count, length, weight) — already loadable from `estimate_items` via the `estimate_item_id` in `source_refs`.
- **Evidence**: the Linked Source viewer block above + raw `source_refs` JSON in a collapsible.
- **Action**: existing `Apply Recommended Fix`, `Return to Takeoff`, `Advance` buttons.

This matches the reference layout without inventing data we don't have.

## Files to edit

- `supabase/functions/auto-estimate/index.ts` — add `page_number`, `bbox`, `image_size` to `source_refs[0]` and to `assumptions_json` when known.
- `src/features/workflow-v2/takeoff-data.ts` — extend `WorkflowQaIssue` with `locator` and `linked_item` (size/count/length/weight); join from `source_refs[0]` + `estimate_items`.
- `src/features/workflow-v2/stages/QAStage.tsx` — replace the right pane with tabs + pinpoint viewer; reuse `PdfRenderer` and the existing signed-URL flow.

## Out of scope

- Rewriting OCR pipeline or storing per-token bboxes globally.
- New tables / migrations.
- DWG/raster image diffing shown in the reference (that requires a revision delta engine — separate roadmap item).
