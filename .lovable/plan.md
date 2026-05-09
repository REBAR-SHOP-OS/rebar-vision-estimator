# Togal-Style Takeoff Canvas — Scope, Takeoff & Blueprint Viewer

Bring the Togal.ai pattern (sheet preview + colored area overlays + right-side layer panel with counts/totals) into our app at the three points where it adds the most value, reusing the components we already have.

## Visual target (from the screenshot you sent)

```text
┌──────────────────────────────────────────────────────────────────┐
│ Sheet name · page nav            [Take off] [Compare]   [Export] │
├──────────────────────────────────┬───────────────────────────────┤
│ ┌─ tools ─┐                      │  All  Area  Line  Count       │
│ │ ▢ ▭ ⌒ ⊙ │                      │  ─────────────────────────    │
│ │ ✏ ⤴ ⤵   │   COLORED OVERLAYS   │  🟢 Footings  ●  42  3.8 t    │
│ └─────────┘   (semi-transparent  │  🟦 Walls     ●  18  1.9 t    │
│                fills per layer,  │  🟧 Slabs     ●   6  6.1 t    │
│                bordered, click   │  🟪 Columns   ●  12  0.7 t    │
│                to open the row)  │  ⬜ Custom-1  ●   3   draft   │
│                                  │  ─────────────────────────    │
│                                  │  Σ Total      ●  81 12.5 t    │
└──────────────────────────────────┴───────────────────────────────┘
```

## Where it appears (and what each one shows)

| Surface | Layers shown | Quantity column | Tool palette |
|---|---|---|---|
| **ScopeStage** (right pane replaces "Construction Buckets") | One layer per approved bucket (Footings, Walls, Slabs, Columns, Misc) | Element count + "Pending TN" until takeoff runs | Polygon, freehand area, hand/select |
| **TakeoffStage** (new "Canvas" tab next to current table) | One layer per takeoff line group (segment_type) | LF / SF / kg per layer + grand total | Same + measure/calibrate ruler |
| **Blueprint Viewer** (`/blueprint-viewer`) | One layer per `element_type` already in `OverlayElement[]` | Just count (no quantity context) | Hand/select only (read-only) |

## Architecture — one shared component, three callers

Create **`src/components/takeoff-canvas/`** (new, ~3 files) so all three surfaces share the same code:

```text
takeoff-canvas/
  TakeoffCanvas.tsx         ← sheet image + overlay SVG + tool palette + page nav
  LayerPanel.tsx            ← right rail: tabs (All/Area/Line/Count), rows, totals
  useCanvasOverlays.ts      ← merges OCR-derived bboxes + manual polygons → one Layer[]
```

Internally `TakeoffCanvas` reuses `BlueprintViewer` + `DrawingOverlay` (already in the project — they handle pan/zoom, page switching, polygon rendering at line 236 of DrawingOverlay). We add:

- A grouped color assignment (by layer id) so each bucket gets a consistent hue.
- A second SVG layer for **manual polygons** (drawn by the user) on top of the existing element overlay.
- A `LayerPanel` that controls visibility, hover-highlight, and click-to-fly-to.

## Data model (one new table, one column)

```sql
-- Manual polygons drawn on top of OCR overlays
CREATE TABLE public.takeoff_overlays (
  id uuid PK default gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  segment_id uuid NULL,           -- the bucket / segment this polygon belongs to
  page_number int NOT NULL,
  source_file_id uuid NULL,
  -- Normalized polygon coords (0..1) so they survive zoom & re-render
  polygon jsonb NOT NULL,         -- [[x,y],[x,y],…]
  area_sqft numeric NULL,         -- computed at save time once scale is known
  color_hint text NULL,
  created_at timestamptz default now()
);
-- RLS: user_id = auth.uid() for ALL.
```

Plus a tiny addition to `segments` so the canvas knows which color to paint:

```sql
ALTER TABLE public.segments
  ADD COLUMN IF NOT EXISTS overlay_color text NULL;   -- e.g. "hsl(140 60% 45%)"
```

No edge-function change required. We keep it minimum-patch: the overlay save/load is just plain `supabase.from('takeoff_overlays')`.

## Auto-link rule (no extra AI call)

Reuse the **existing OCR elements** already returned by `auto-segments` / persisted with bboxes. In `useCanvasOverlays.ts`:

```text
For each segment (bucket):
  derived = ocrElements.filter(e =>
    inferSegmentType(e.element_type) === segment.segment_type
    && (e.page_number ?? 1) === currentPage
  )
  layer.elements = [...derived, ...manualPolygons.filter(p => p.segment_id === segment.id)]
  layer.count    = layer.elements.length
  layer.area     = sum(area for polygons)   // shown when scale is known
```

`inferSegmentType` already lives in `ScopeStage.tsx` — extract to `src/lib/segment-type.ts` and reuse.

## Manual draw tool (Togal-equivalent)

In `TakeoffCanvas` add three tools (kept simple — no Konva, no Fabric):

1. **Polygon** — click points, double-click or Enter to close. Saves to `takeoff_overlays`.
2. **Rectangle** — drag-create.
3. **Eraser** — click an existing manual polygon to delete (only manual ones, never OCR-derived).

A small toolbar floats at the top-left of the canvas, mirroring Togal's vertical rail. Keyboard: `V` select, `P` polygon, `R` rectangle, `E` erase, `Esc` cancel.

## Stage-by-stage UX

### 1) ScopeStage — `src/features/workflow-v2/stages/ScopeStage.tsx`

- Keep the left "Candidate" column and the action rail unchanged.
- Replace the right "Approved Buckets" pane with `<TakeoffCanvas mode="scope" projectId={projectId} segments={accepted}/>`.
- The current bucket grid moves into the `LayerPanel` (right of the canvas) as collapsible rows with the same `name / units` text — so nothing is lost.

### 2) TakeoffStage — `src/features/workflow-v2/stages/TakeoffStage.tsx`

- Add a **`Table | Canvas`** segmented toggle at the top of StageHeader.
- **Table** = today's view (untouched). **Canvas** = `<TakeoffCanvas mode="takeoff" projectId={projectId} estimateItems={items}/>`.
- LayerPanel groups by `item_type` / `bar_size`, shows `total_length` + `total_weight`.
- Clicking a layer row scrolls the table and selects that row underneath when the user flips back.

### 3) Blueprint Viewer — `src/components/chat/BlueprintViewer.tsx`

- Already has the canvas — only the panel is missing. Mount `<LayerPanel mode="readonly" elements={elements}/>` on the right rail (slide-in, default open on ≥`lg`).
- No new tools (read-only context: drawing back-references from chat).

## Files touched

```text
NEW  src/components/takeoff-canvas/TakeoffCanvas.tsx
NEW  src/components/takeoff-canvas/LayerPanel.tsx
NEW  src/components/takeoff-canvas/useCanvasOverlays.ts
NEW  src/lib/segment-type.ts                          ← extracted from ScopeStage
NEW  supabase/migrations/<ts>_takeoff_overlays.sql

EDIT src/features/workflow-v2/stages/ScopeStage.tsx   ← swap right pane only
EDIT src/features/workflow-v2/stages/TakeoffStage.tsx ← add Table/Canvas toggle
EDIT src/components/chat/BlueprintViewer.tsx          ← mount LayerPanel
EDIT src/components/chat/DrawingOverlay.tsx           ← accept colorBy="layer" prop
```

No edge functions, no auth changes, no edits to `auto-segments`, `auto-estimate`, or any pipeline code. All other stages (Files, Calibration, QA, Confirm, Outputs) are untouched.

## What this changes for the user

- Scope feels visual instead of list-only — they see *where* each approved bucket lives on the sheet.
- Takeoff gets a one-click "show me on the drawing" view that matches industry tools they already know.
- Blueprint Viewer becomes a real layer-aware viewer instead of an opaque overlay dump.
- Manual polygons let the estimator add what OCR missed without leaving the page — closing the gap with Togal.

## Out of scope (call out if you want it)

- True vector-quality polygon editing (handles, snap-to-line, Boolean ops).
- Cross-sheet layer aggregation in one panel (per-page only, like Togal).
- Saving canvas layers per user instead of per project.
- Compare mode (Togal's second tab) — easy follow-up later, not in this plan.
