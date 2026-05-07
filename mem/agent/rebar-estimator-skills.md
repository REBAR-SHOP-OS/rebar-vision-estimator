---
name: Rebar Estimator Master Skill Set
description: Full master skill model for rebar estimating — drawing reading, segments, callouts, element-specific rules, fabrication, placing, pricing, RFI format, error catching, confidence classification. RSIC-aligned.
type: feature
---

# Master Rebar Estimator Skill Set (RSIC-aligned)

## Mindset
- Geometry defines the segment.
- Callout defines the reinforcement.
- Code/detail defines the length.
- Fabrication defines the practical bar.
- Placement defines the risk.
- Pricing defines the quote.
- **If details are missing or parts are not designed, do NOT assume reinforcing — flag RFI.**

## Drawing-reading order
1. Structural plans → 2. sections → 3. details → 4. schedules → 5. general notes → 6. arch plans → 7. arch sections/elev → 8. civil → 9. M/E only if embeds/sleeves/pads affect concrete.
- Structural drawings CONTROL rebar. Architectural helps locate dimensions, openings, finishes.

## Terminology (must know instantly)
EW, EF, T&B, O/C, VEF/HEF/VOC/HOC, BOT/TOP, CONT, ADD'L, ALT, DWL, FTG, SOG, GB, CJ, EJ, Ld, TLS, WWF/WWM, STR, STIRR, U.N.O.

## Core math
- Bars = (dimension across spacing ÷ spacing) + 1
- Total length = qty × cut length
- Weight = total length × kg/m
- Mesh sheets = slab area ÷ sheet area
- Order qty = net × (1 + waste %)
- Slope length = √(run² + rise²)
- Arc length = radius × angle (rad)
- Loose rebar → bar count + cut length. WWM → area coverage. Never mix.

## Segment detection (CRITICAL)
Start a NEW segment whenever ANY of these change: dimension, elevation, thickness, bar size, spacing, layer, direction, element, opening, CJ/EJ, lap condition, hook condition, wall height, footing step, mat type, finish, special material.
Estimate by: wall run / wall return / wall opening zone / corner bars / footing step / pad zone / slab edge thickening / control joint zone / top mat / bottom mat / extras around openings / dowels at CJ.

## Callout interpretation rules
- "15M @ 300 O/C EW" = 15M, 300mm O.C., each way (both directions).
- "10M VERT @ 300 O/C" = vertical only.
- "20M @ 200 EF" = each face (×2).
- WWM "152x152 MW18.7/18.7" → mesh, area-based, NOT loose rebar.

## Element-specific
**Pads/spread footings**: long-way bars counted across SHORT dim; short-way counted across LONG dim. Cut length default = dim − 150mm (RSIC: 75mm cover each face).
**Strip footings**: by wall run; separate stepped footings; corners/intersections/piers.
**Walls**: vertical = L/spacing+1; horizontal = H/spacing+1; EF doubles; add dowels, corners, openings, pilasters, CJs.
**SOG loose**: same formula as pad. Separate thickened zones, control joint panels.
**SOG WWM**: sheets = area / sheet area + lap + waste. Don't compute cut lengths.
**Beams/grade beams**: stirrups = L/spacing+1; stirrup CL = 2(w+d)+hooks.
**Columns/piers**: ties = H/spacing+1; tie out-to-out = column dim − 80mm (RSIC).
**Dowels**: count = run/spacing+1; length = embed + projection + hook/lap.
**Stairs**: slope length √(run²+rise²); top/bottom mat; landings; nosing; dowels.
**Curved**: arc length; chord; check shop vs field bend, transport limits.
**Masonry**: per engineer detail only — never assume.

## Fabrication awareness
Stock: 12m for 10M, 18m for 15M+. >18m needs splice/coupler/weld. Bundle/tag/load planning. Bend pin diameter per RSIC appendix. No bend/straighten that fractures.

## Lap / splice / hooks
- Never invent lap if not shown — flag.
- Hooks: 90/135/180; pin diameter from RSIC appendix; out-to-out dims.

## Standards (Canadian)
RSIC Manual of Standard Practice 2018, CSA A23.1/.2/.3, CSA G30.18, CSA W186, CSA S304 (masonry), ASTM A1064 (WWF), A775 (epoxy), A767 (galv), OBC.

## Materials & weights (CSA G30.18, kg/m)
10M=0.785, 15M=1.570, 20M=2.355, 25M=3.925, 30M=5.495, 35M=7.850, 45M=11.775, 55M=19.625.

## Scope & exclusions (always state explicitly)
Epoxy/galv/SS/FRP, mech splices, threading, sawcut, welding, special bends, hot bends, site inspection, eng-stamped drawings, additional tying, PT, precast, masonry rebar, caisson rebar, supports/chairs, crane unloading, OT, winter, field fab.

## Pricing components
Material, fabrication, bending, delivery, placing, accessories, detailing, shop drawings, special material, waste, escalation, add/del, OT, crane, risk allowance.
Contract types: lump sum, unit price, supply only, place only, S+P.

## Production optimization
Cutting stock optimization on 12m/18m. Waste-bank reuse. Bar mark grouping. Sequence by pour & delivery & install. Cutter/bender capacity. Truck loading.

## Scaling rules
1) Prefer written dim. 2) Same view. 3) Calibrate from known. 4) Mark approximate. 5) Never fabricate from scaled-only without confirmation.

## AI traceable output (every row)
Found item · Sheet/page/detail · Callout · Dimensions used · Formula · Calculation · Result · Assumptions · Confidence · Needs-review flag.

## Error catching (highest-leverage skill)
Missing size/spacing/length, arch↔struct mismatch, scale mismatch, imp↔metric mismatch, WWM mistaken as rebar, top/bot omitted, EF omitted, double mat missed, openings undeducted, corners missed, laps/hooks/dowels missed, special material missed, revision changes.

## Confidence classification (every item)
Confirmed (explicit) · Approximate (scaled/inferred) · Needs Review (key info missing) · Excluded (not in scope) · Extra (post-bid).

## RFI format (mandatory)
Location · Object · Drawing/page/detail · Found callout · Missing information · Why required · Proposed assumption · Please confirm.

## Per-item checklist (24 questions)
element · location · controlling drawing · callout · type (loose/mesh/dowel/stirrup/tie/special) · controlling dimensions · explicit-or-scaled · spacing · direction · faces (1F/EF/T&B/double mat) · cover or end-to-end · laps · hooks · openings · corners/returns · CJs · special materials · fabrication-possible · placing-possible · weight by size · waste/drop · exclusions · RFI needed · confidence.
