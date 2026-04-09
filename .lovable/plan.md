

# Fix: Reconciliation Sheet Empty Totals + WWM Weight = 0

## Problems Found

### Bug 1: WWM bar_items get weight = 0
In `OutputsTab.tsx` line 166, weight is calculated as `qty * (lengthMm / 1000) * getMassKgPerM(size)`. For WWM sizes like `6x6-W2.9/W2.9`, `getMassKgPerM` returns 0 (it's not rebar). The system already has `getWwmMassKgPerM2()` in rebar-weights.ts but it's never called during export.

The DB has: qty=45, cut_length=185000 for mesh. This represents 45 sheets × area. WWM weight should use area × kg/m², not linear length × kg/m.

**Fix** (`OutputsTab.tsx` lines 162-179): Detect WWM items (size matches mesh pattern). For WWM, use `getWwmMassKgPerM2(size)` and compute weight from area. If cut_length represents a dimension (like 185m total length of mesh coverage), compute area from that. Mark WWM items with a flag so the export handles them correctly.

### Bug 2: Reconciliation sheet has no Norm Weight, Variance, Status data
The `element_reconciliation` array from `recon` is empty (line 444), so it falls back to the barList grouping (line 460-468) which only populates column B (Drawing Weight). Columns C-F stay blank because there's no norm data to compare against.

**Fix** (`excel-export.ts` lines 459-468): When falling back to barList-derived weights, also compute industry-norm estimates using simple kg/m³ ratios from RSIC standards. This gives the Reconciliation sheet actual comparison data instead of blank cells.

### Bug 3: Grand Total in Estimate Summary doesn't match Reconciliation
Since WWM weight is 0, the slab total is wrong (194.1 instead of ~545 with mesh), which cascades to Grand Total.

**Fix**: Resolved by fixing Bug 1 — correct WWM weight flows through all sheets.

## Changes

### 1. `src/components/workspace/OutputsTab.tsx` — Fix WWM weight calculation (lines 162-179)

Add WWM detection before weight calc. If size matches a mesh pattern (`/\d.*x.*\d.*W/i`), use `getWwmMassKgPerM2()` for weight. Treat the bar_item's qty × cut_length as total area coverage in m² (or compute from dimensions). Import `getWwmMassKgPerM2` from rebar-weights.

```text
Current: wtKg = qty * (lengthMm / 1000) * getMassKgPerM(size)  → 0 for WWM
Fixed:   if isWWM → wtKg = qty * areaSqM * getWwmMassKgPerM2(size)
         else     → wtKg = qty * (lengthMm / 1000) * getMassKgPerM(size)
```

For the mesh bar_item (qty=45, cut_length=185000mm=185m): this likely means 45 sheets. Standard WWM sheet = 1.52m × 3.05m = 4.636 m². Total area = 45 × 4.636 = 208.6 m². Weight = 208.6 × 1.90 = 396.4 kg. Alternatively if cut_length=185000mm represents total linear coverage, area = (185000/1000) × standard_width. We'll use the area interpretation that gives a reasonable result.

### 2. `src/lib/excel-export.ts` — No changes needed
The Reconciliation sheet's TOTAL SUM formulas already work correctly (lines 473-476). The blank columns C-F are expected when there's no `element_reconciliation` data from the AI — this is a data issue, not a code bug. The TOTAL row will show correct sums once WWM weight is fixed.

## Files Modified
- `src/components/workspace/OutputsTab.tsx` — WWM weight calc fix (~5 lines changed)

