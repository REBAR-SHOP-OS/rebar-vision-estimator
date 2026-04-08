

# Add Wire Mesh (WWM) Support to Auto-Estimate

## Problem
When drawings specify wire mesh (e.g., "WWM 6x6 W2.9/W2.9" for slabs-on-grade), the system currently estimates rebar instead. It should detect WWM callouts in drawing text and generate wire mesh items with proper area/sheet-based calculations.

## Changes

### 1. Auto-Estimate Edge Function — WWM Detection & Calculation
**File**: `supabase/functions/auto-estimate/index.ts`

Update the AI system prompt to:
- Detect wire mesh callouts in drawing text (WWM, welded wire mesh, mesh designations like 6x6-W2.9/W2.9, 152x152 MW9.1/MW9.1)
- When mesh is found, generate items with `item_type: "wwm"` instead of `"rebar"`
- WWM items use different fields: `description` (mesh designation), `bar_size` (mesh spec e.g. "6x6-W2.9"), `quantity_count` (number of sheets), `total_weight` (kg), `total_length` (area in m²)
- Include WWM weight reference in prompt: common mesh weights (kg/m²) — e.g. 6x6-W1.4/W1.4 = 0.93 kg/m², 6x6-W2.9/W2.9 = 1.90 kg/m², 6x6-W4.0/W4.0 = 2.63 kg/m²
- For SOG/slab segments: if drawing text contains mesh notation, estimate mesh; if it contains rebar notation, estimate rebar; if both, estimate both
- Apply sheet count calculation: standard sheets 5'x10' (1.52x3.05m = 4.65 m²), with 150mm (6") overlap allowance

### 2. Rebar Weights Utility — Add WWM Weight Table
**File**: `src/lib/rebar-weights.ts`

Add a `WWM_KG_PER_M2` lookup table for common mesh designations and a `getWwmMassKgPerM2(designation)` function so the UI can compute weights consistently for WWM items (same pattern as `getMassKgPerM` for rebar).

Common designations:
- 6x6-W1.4/W1.4 = 0.93 kg/m²
- 6x6-W2.1/W2.1 = 1.37 kg/m²
- 6x6-W2.9/W2.9 = 1.90 kg/m²
- 6x6-W4.0/W4.0 = 2.63 kg/m²
- 4x4-W2.1/W2.1 = 2.05 kg/m²
- 4x4-W4.0/W4.0 = 3.94 kg/m²
- 152x152 MW9.1/MW9.1 = 1.90 kg/m² (metric equivalent)

### 3. SegmentDetail.tsx — Display WWM Items Properly
**File**: `src/pages/SegmentDetail.tsx`

In the estimate items table and weight calculation box:
- For `item_type === "wwm"`: show "Area (m²)" instead of "Length (m)" in the table
- Weight calc explanation: `Weight = Area (m²) × mass (kg/m²)` instead of the rebar formula
- Summary cards: separate rebar weight from mesh weight totals

## No new files, no migrations, no edge function changes (only prompt update to existing auto-estimate)

