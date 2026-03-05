

## Fix: Incorrect Total Weight from Excel Import — Unit Normalization & Per-Row Weight Calculation

### Root Cause Analysis

The Excel import in `BarListTable.tsx` has **three critical bugs** causing systematic weight undercount:

1. **Hardcoded mm-to-ft assumption (line 47)**: `totalLengthMm / 304.8` — always assumes the "TOTAL LENGTH" column is in mm, but real Excel files use metres ("Mtr."), inches, or feet. If the column is in metres and the value is `17.437`, it gets divided by 304.8 → 0.057 ft instead of the correct 57.2 ft. This alone causes a ~1000x undercount.

2. **Imperial unit weights for metric bars (lines 11-16)**: The `REBAR_UNIT_WEIGHT` table stores lb/ft values. For metric sizes (10M, 15M, 20M...), the values listed (`0.527, 1.055...`) are lb/ft conversions, but the weight formula `qty * length_ft * unitWt` produces lbs. The system never computes kg directly — it should use kg/m for metric bars and compute `weight_kg` natively.

3. **No multiplier support**: Excel files often have a "MULTIPLIER" or "NO. OF MEMBERS" column. The parser ignores it, so a row with multiplier=2 counts as 1x.

4. **No formula evaluation**: `XLSX.utils.sheet_to_json` reads computed values by default, but if the workbook has external references or was saved without cached values, formulas return as strings. No fallback logic exists.

5. **No cross-check validation**: If the Excel has a "TOTAL WEIGHT" summary cell, the system never compares its computed total against it.

### Solution

**A. Rewrite `parseXlsxToBarItems` in `BarListTable.tsx`**

- **Unit detection**: Scan headers for unit keywords (`Mtr`, `Meter`, `mm`, `Millimeter`, `inches`, `ft`, `Feet`). Default to mm if ambiguous but flag it.
- **Normalize to mm internally**: Convert all detected lengths to mm first.
- **CSA metric weight table (kg/m)**: Add a proper `METRIC_MASS_KG_M` table alongside the existing imperial one. Use it directly for metric sizes.
- **Per-row weight formula**: `weight_kg = qty * multiplier * (length_mm / 1000) * mass_kg_per_m(size)`
- **Convert to lbs for display**: `weight_lbs = weight_kg / 0.453592`
- **Multiplier column**: Parse "MULTIPLIER", "NO. OF MEMBERS", "MULTI", "NO OF MEM" headers.
- **Formula fallback**: Check if parsed values are strings starting with `=`; if so, recompute from qty * unit_length * multiplier.

**B. Add cross-check validation**

- After parsing all rows, scan the worksheet for cells containing "TOTAL WEIGHT" or "TOTAL WT" text.
- If found, compare the adjacent numeric cell to `SUM(item_weights)`.
- If mismatch > 1%, show a diagnostic toast/warning with: detected units, row count, computed total vs Excel total, any missing sizes.

**C. Add `BarItem` fields**

- Add `weight_kg: number` to BarItem interface
- Add `multiplier: number` to BarItem interface  
- Add `length_mm: number` for internal tracking
- Add `assumptions: string[]` for flagging defaults used

**D. Update weight display to show kg as primary**

- Grand total and subtotals show kg and tonnes (primary) with lbs/tons secondary
- Show warning badge when assumptions were used (e.g., "Unit assumed: mm")

**E. Update `ExportButtons.tsx` and `ReviewReport.tsx`**

- Use the same corrected weight table
- Export kg columns alongside lbs

**F. Add regression test**

- New test case in `detection-regression.test.ts` with a fixture representing the user's workbook (expected total ≈ 5382.44 kg)

### Files to Change

| File | Changes |
|---|---|
| `src/components/chat/BarListTable.tsx` | Rewrite `parseXlsxToBarItems` with unit detection, mm normalization, CSA kg/m table, multiplier, cross-check validation, assumptions tracking |
| `src/components/chat/ExportButtons.tsx` | Add kg columns, use corrected weight table |
| `src/components/chat/BendingScheduleTable.tsx` | Add `weight_kg` display |
| `src/test/detection-regression.test.ts` | Add Excel-import weight accuracy test fixture |

### Weight Tables (Correct Values)

```typescript
// CSA G30.18 — kg/m (authoritative for metric sizes)
const CSA_METRIC_KG_M: Record<string, number> = {
  "10M": 0.785, "15M": 1.570, "20M": 2.355, "25M": 3.925,
  "30M": 5.495, "35M": 7.850, "45M": 11.775, "55M": 19.625,
};

// Imperial — lb/ft (kept for imperial sizes)
const IMPERIAL_LB_FT: Record<string, number> = {
  "#3": 0.376, "#4": 0.668, "#5": 1.043, "#6": 1.502, "#7": 2.044,
  "#8": 2.670, "#9": 3.400, "#10": 4.303, "#11": 5.313, "#14": 7.650, "#18": 13.600,
};
```

### Unit Detection Logic

```typescript
function detectLengthUnit(headers: string[]): { unit: "mm" | "m" | "ft" | "in"; assumed: boolean } {
  const joined = headers.join(" ").toLowerCase();
  if (/mtr\.?|meter|metre/.test(joined)) return { unit: "m", assumed: false };
  if (/millimeter|mm\b/.test(joined)) return { unit: "mm", assumed: false };
  if (/feet|ft\b|foot/.test(joined)) return { unit: "ft", assumed: false };
  if (/inch|in\b|"/.test(joined)) return { unit: "in", assumed: false };
  return { unit: "mm", assumed: true }; // default with flag
}

function toMm(value: number, unit: string): number {
  switch (unit) {
    case "m": return value * 1000;
    case "ft": return value * 304.8;
    case "in": return value * 25.4;
    default: return value; // mm
  }
}
```

