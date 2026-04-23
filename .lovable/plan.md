

# Fine-tune AI Draft to look like a real SD sheet (SD48–SD53 style)

Reference: your `SD48_TO_SD53_R1` set is a landscape 11×17 CAD-style sheet — heavy outer border, formal right-edge title strip, layer/legend column, dense plan view in the middle, and a bar bending schedule docked on one side. Today's AI draft is a portrait styled HTML report. We close the visual gap with surgical edits to **one file**: `supabase/functions/generate-shop-drawing/shop-drawing-template.ts`. No new files, no pipeline changes.

## What changes

### 1. Sheet geometry — match real SD format
- Switch page to **landscape 17"×11" (ANSI B / Tabloid)** via `@page { size: 17in 11in landscape; margin: 0 }`.
- Sheet element becomes a true full-bleed CAD frame: 0.4" outer border, 0.15" inner border (double-line), tick marks at quarter points (A/B/C zone marks like real CAD sheets).
- Keep amber border + watermark **only** in `ai_draft` mode (already wired). In review/issued, switch to black double-line frame.

### 2. Right-edge title strip (vertical) — replace top title block
Real SD sheets put the title block as a tall vertical strip on the right edge, not across the top. Restructure the sheet into a CSS grid:

```text
┌──────────────────────────────────────────┬─────────┐
│                                          │  LOGO   │
│                                          │─────────│
│           DRAWING AREA                   │ PROJECT │
│       (plan / elevation / section)       │ CLIENT  │
│                                          │ ADDRESS │
│                                          │─────────│
│                                          │ SHEET # │
│                                          │ SCALE   │
│                                          │ DATE    │
│                                          │ REV     │
├──────────────────────────────────────────┤─────────│
│  LAYER LEGEND  │  BAR BENDING SCHEDULE   │ DRAWN   │
│                │                         │ CHECKED │
│                │                         │ APPRVD  │
└──────────────────────────────────────────┴─────────┘
```

- Right strip: 2.2" wide, full height, stacked cells with bold labels above values.
- Drawing area: ~13" wide × ~8" tall, white background, light dot-grid at 0.5" intervals (mimics CAD paper).

### 3. Layer legend column (new)
Bottom-left strip lists the layers present, mirroring the real SD's OCG layers (APRON SLAB, PIER, CMU WALLS, CONCRETE STEM WALLS, STEEL, CONT. GRID, HIDDEN). Each row: colored swatch + name + line style sample. Layers are derived from `barList` element_types (FOOTING → "FOOTING / FDN", WALL → "WALL", etc.) so it stays honest about what data exists.

### 4. Bar Bending Schedule — real SD column set
Replace the current schedule columns with the canonical ACI/CRSI placing-drawing column order seen in SD48-style sheets:

`MARK | SIZE | TYPE | NO. | LENGTH | A | B | C | D | E | R | WEIGHT | REMARKS`

- Monospace numerals, 8pt, dense rows.
- Section header bands (e.g., "FOOTINGS — F1") in light gray fill.
- Empty bend dimensions render as `—` instead of blank to match drafting convention.

### 5. Drawing area content — honest placeholder
Instead of the current "diagram-ish HTML", render a **labeled placeholder block per element group** inside the drawing area:
- A bordered rectangle per element_type, sized proportionally to bar count.
- Inside: element_id, count, dominant size, and a small bend-shape SVG icon (straight, L-bend, U-bend, stirrup) inferred from `shape_code`.
- Stamped diagonally across the drawing area in `ai_draft` mode: `SCHEMATIC — NOT TO SCALE` (small, 14pt, 12% opacity) so it never reads as a measured drawing.

### 6. Title strip metadata — fix the bugs you saw earlier
- Date field uses validator's ISO output (`YYYY-MM-DD`); fall back to today if invalid.
- Discipline label normalized via existing `validateDrawingMetadata` canonical list (no more "Architectral").
- Sheet number format: `{prefix}{NN}` (e.g., `SD-01`) zero-padded, one per page.
- Revision cell shows `AI-D` chip in ai_draft mode (not a triangle), `R0/R1/...` only in issued mode.

### 7. Typography & ink
- Switch body font to a CAD-style stack: `"RomanS", "Consolas", "Courier New", monospace` for all labels and schedule cells; `"Helvetica Neue", Arial, sans-serif` only for the title strip headings.
- Line weights: 2pt outer frame, 1pt inner frame, 0.5pt schedule grid, 0.25pt drawing-area grid.
- Pure black ink (`#000`) on pure white (`#fff`); amber only in ai_draft accents.

## Files changed

| File | Change | Approx LOC |
|---|---|---|
| `supabase/functions/generate-shop-drawing/shop-drawing-template.ts` | Page CSS to landscape 17×11, new grid layout, vertical right title strip, layer legend, redesigned BBS columns, schematic placeholder blocks, mode-aware frame & stamps | ~180 lines edited / added in one file |

No DB migration. No new modules. No changes to OutputsTab capture pipeline (already fixed for blank PDF). Existing tests in `src/test/shop-drawing-template.test.ts` will need their string assertions updated to match new headers — same file, same test, just new expected substrings.

## Out of scope (would need a real renderer)

- True vector linework of plans/elevations/sections (would require an SVG draft engine fed by deterministic geometry — Phase 3 of the trust-first plan).
- Scale-accurate dimensioning. AI draft will keep the `SCHEMATIC — NOT TO SCALE` stamp until the deterministic geometry layer ships.
- Layer toggle interactivity (real SDs' OCGs). HTML/PDF can show the legend but not toggle.

## Why this is the right minimal patch

You asked for "fine tune like SD" — i.e., make the AI draft *look* like SD48. The honest gap is layout + framing + schedule format + typography, not pixel-perfect CAD geometry. All of those are CSS/HTML in one template file. Doing more (vector geometry) would violate the minimum-patch policy and double back on the earlier roadmap.

