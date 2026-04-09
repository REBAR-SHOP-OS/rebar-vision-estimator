

# Audit & Fix: Clean Data + Fix Double-Counting Export

## Audit Findings

### Reference (Real Shop Drawings SD06-SD12)
The uploaded PDF shows the actual professional bar list with:
- **Footings**: F-1 through F-8 (isolated footings with schedule), continuous wall footing (FW) with 20M continuous T&B + 15M dowels
- **Piers**: P1-P8 (4x15M vertical + 10M ties)
- **Step on Grade**: 3x10M continuous longitudinal + transverse
- **Walls**: W1-W8 elevations with 20M continuous bars, 10M vertical bars, 15M dowel/vertical, ties
- **Slab on Grade**: WWM 152x152xMW18.7/18.7 only (1,236.23 m²)
- **Reference Total**: 5,382.44 kg rebar + 1,236 m² mesh

### Current DB Data (Project 5822e3b4)
- Generic AI-guessed items: "Beam Bottom Longitudinal Reinforcement - Main Span", "Slab on Grade Main Reinforcement" etc.
- No real bar marks from the drawings (no BS03, BS04, B1001, etc.)
- Estimate items show: Footings 676 kg, Slabs 4,493 kg, Walls 3,391 kg, Beams 320 kg, Columns 232 kg = ~9,112 kg
- **Slabs segment wrongly has rebar items** — the real drawing shows slab is WWM only
- **Beams/Columns segments exist** but the reference shows no standalone beams/columns — piers are part of footings

### Bug: Double-Counting in Export (OutputsTab.tsx lines 184-189)
```
sizeBreakdownKg += bar_items weights  (line 183)
sizeBreakdownKg += estimate_items weights  (lines 185-189)  ← DOUBLE
```
Both sources represent the same data, inflating the exported total by 2x.

### Trash/Old Projects
3 duplicate "CRU-1 Architectral" projects (L0, no segments) + "image" project + duplicate "7200 Martin Grove" — all dead.

## Plan

### 1. Fix Double-Counting in OutputsTab.tsx (lines 184-189)
Remove the estimate_items accumulation block. When bar_items exist, they ARE the detailed breakdown — adding estimate_items on top doubles everything.

**Change**: Lines 184-189 — only add estimate_items to `sizeBreakdownKg` when `barList` is empty (no bar_items exist).

### 2. Clean Trash Data
Delete old/duplicate projects and their orphaned data via insert tool:
- 3x "CRU-1 Architectral" (c49fdf4a, 16d66b23, c7372e30)
- "image" (0b28b909)
- Duplicate "7200 Martin Grove" (90af759f)

### 3. No estimate data changes
The current AI-generated estimates for project 5822e3b4 are what the system produced. The reference PDF (SD06-SD12) is the real shop drawing answer — this will be used for future fine-tuning of the auto-estimate and auto-bar-schedule prompts, but cleaning/replacing the current data requires re-running the estimation pipeline, not manual patching.

## Files Modified
- `src/components/workspace/OutputsTab.tsx` — fix double-counting (lines 184-189)
- Database cleanup via insert tool (delete 5 trash projects)

