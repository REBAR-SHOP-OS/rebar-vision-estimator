

# Analysis: Why the System Estimated 12x Higher Than Manual

## Weight Comparison

| Source | Total Rebar (kg) | Notes |
|--------|-----------------|-------|
| Manual (LONDON_CRU1.xlsx) | **5,382 kg** | Foundation-only scope + SOG mesh |
| System (auto-estimate) | **63,854 kg** | Full superstructure scope |

## Root Cause: Scope Mismatch

The manual estimate covers **foundations only** (footings F1–F8, piers P1–P8, step-on-grade, foundation walls). The system auto-estimate generated items for the **entire building** including:

| Element | System Weight (kg) | In Manual? |
|---------|-------------------|------------|
| Slab (suspended) | 19,938 | NO — manual only has SOG mesh |
| Wall | 5,409 | NO |
| Beam | 2,434 | NO |
| Column | 1,947 | NO |
| Footing | 650 | YES — manual has ~2,500 kg |
| Stair | 344 | NO |

The manual estimate is a **foundation-only** takeoff. The system estimated the **full structure** (slabs, walls, beams, columns, stairs) because the AI prompt generates items for all segment types it finds.

## Secondary Issues

1. **Footing weight discrepancy**: Even for footings alone, manual = ~2,500 kg vs system = 650 kg. The system under-counted footings while over-counting everything else.
2. **Slab overestimate**: 19,938 kg for slab is very heavy — the AI generated large quantities of 15M bars at 12m lengths (180 bars × 12m = 2,160m per layer). This suggests the AI assumed a large suspended slab area without drawing verification.
3. **No drawing-based verification**: The auto-estimate uses AI inference from segment types, not actual drawing data. It guesses typical reinforcement patterns rather than reading schedules.

## What Needs to Change (Fine-Tuning Plan)

### 1. Scope-Aware Estimation
Modify `auto-estimate` edge function to:
- Check uploaded drawing disciplines (structural foundation vs structural superstructure)
- Only estimate segments that match the uploaded drawing scope
- Add a "scope_coverage" field so users know what's included vs excluded

### 2. Drawing-Driven Estimation
Instead of pure AI inference, the estimate should:
- Use extracted text from PDFs (the `extract-pdf-text` function already exists)
- Parse footing schedules, bar schedules, and rebar callouts from drawings
- Cross-reference with the shop drawing data (SD06–SD12 shows exact bar marks, sizes, quantities)

### 3. Footing Schedule Integration
The SD06 PDF contains exact footing schedules (F-1 through F-8 with sizes, reinforcement, quantities). The system should parse these and use them directly instead of AI-guessing.

### 4. Add Scope Filter to Auto-Estimate
Add a parameter to `auto-estimate` that restricts generation to specific element types matching the drawing set (e.g., "foundation only" if only foundation drawings are uploaded).

### 5. Weight Validation Gate
Add a post-estimation check: compare AI-generated weights against typical ratios (kg/m² for slabs, kg/m³ for foundations) and flag outliers before saving.

## Files to Modify
- `supabase/functions/auto-estimate/index.ts` — add scope filtering, drawing text context, weight validation
- `src/components/workspace/SegmentsTab.tsx` — show scope coverage badge per segment

## No new files, no migrations

