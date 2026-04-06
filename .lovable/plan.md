

# Restructure Shop Drawing to Match Reference Format (Single-Segment Sheets)

## What the Reference Drawing Shows

The uploaded CABANA FOUNDATION SD22 is a **single-page consolidated shop drawing** per structural segment containing ALL of these zones on one sheet:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  FOUNDATION PLAN LAYOUT        │  BBS TABLE (bar schedule)   │ SHAPES  │
│  (structural plan with         │  (bar mark, size, shape,    │ (T1, I7 │
│   element callouts &           │   qty, length, legs, etc.)  │  SVGs)  │
│   dimensions)                  │                             │         │
│                                │                             │         │
├────────────────────────────────┤─────────────────────────────┤─────────┤
│  SECTION DETAILS               │  MESH SCHEDULE              │         │
│  (cross-section views with     ├─────────────────────────────┤ LAP     │
│   rebar placement callouts)    │  LAP SCHEDULE │COVER DETAILS│ SCHED   │
│                                │               │             │         │
├────────────────────────────────┤───────────────┴─────────────┤─────────┤
│  TYPICAL BAR ARRANGEMENT       │  REVISION TABLE (△ markers) │         │
│  DETAILS                       ├─────────────────────────────┤         │
│  (corner/wall details)         │  TITLE BLOCK (REBAR.SHOP)   │  SD22   │
└────────────────────────────────┴─────────────────────────────┴─────────┘
```

## Current vs. Required

| Current | Required |
|---------|----------|
| Sheet 1: Summary dashboard (metrics, cards) | **Remove** — no summary dashboard |
| Sheet 2+: BBS table pages | **Merge** BBS onto each segment sheet |
| Sheet 3+: Shape key pages | **Merge** shapes onto each segment sheet |
| No plan layout / section views | **Add** plan layout + section placeholders |
| No mesh schedule on sheet | **Add** mesh schedule table |
| No lap/cover tables | **Add** lap schedule + cover details tables |
| No typical bar arrangement | **Add** typical bar arrangement detail |

## Plan

### 1. Fix build error (`supabase/functions/mcp-server/index.ts`)
- Change `npm:mcp-lite@^0.10.0` to use a CDN import (`https://esm.sh/mcp-lite@0.10.0`) to resolve the Deno module resolution error

### 2. Restructure `src/lib/shop-drawing-template.ts`

**Replace the multi-sheet approach** with a single-sheet-per-segment layout:

**New sheet layout** (matching reference exactly):
- **Top-left quadrant**: Foundation Plan Layout placeholder (labeled diagram area showing element positions with callout labels like "CB1 20"Wx22"D", "5" THK T/5" SLAB", etc.) — generated from element data
- **Top-right area**: BBS table (full bar bending schedule for this segment)
- **Right of BBS**: Shape key SVGs (T1, I7, STRAIGHT, etc.)
- **Middle-right**: Mesh Schedule table (Location, Mesh Size, Sheet Size, Sheet Qty, Total Area)
- **Below mesh**: Lap Schedule table (Size, Lap Splice) + Cover Details table (Sides, Clearance)
- **Bottom-left**: Section detail view + Typical Bar Arrangement Details (schematic showing BOT. COR., BOT. CONT., @WALL CORNER positions)
- **Bottom-right**: Revision table with triangle (△) markers + Title block (REBAR.SHOP branding, project name, part of structure, customer, drawing no., bar list no.)

**Key structural changes:**
- Remove `createSummarySheet()` — no separate summary page
- Modify `buildScheduleSheets()` → `buildSegmentSheets()` — one sheet per element group (e.g., "CABANA FOUNDATION") containing BBS + shapes + reference tables all in one
- Replace the 2-column grid layout with a more complex CSS grid matching the reference zones
- Add `buildPlanLayoutSvg()` — generates schematic plan view from element bounding boxes
- Add `buildSectionDetailSvg()` — generates cross-section schematic from bar data
- Add `buildMeshScheduleTable()` — mesh data table
- Add `buildLapCoverTables()` — lap schedule + cover details (derived from standard/bar sizes)
- Add `buildTypicalBarArrangement()` — SVG showing corner/wall bar placement patterns
- Update revision table to use △ markers (△0, △1, △2...)

**Data flow:**
- Bars grouped by structural segment (e.g., all foundation bars on one sheet)
- Each segment gets its own complete shop drawing sheet
- If a segment has too many bars, overflow to continuation sheet(s) with same layout

### 3. Update edge function (`supabase/functions/generate-shop-drawing/index.ts`)
- No changes needed — it already calls `buildShopDrawingHtml()` and returns the HTML

### Files Modified
- `supabase/functions/mcp-server/index.ts` — fix import (1 line)
- `src/lib/shop-drawing-template.ts` — major restructure to match reference format

