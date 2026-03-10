

## Plan: Fix Missing Weights + Match Reference Excel/PDF Format

### Problem Analysis

Comparing your reference file (`20_york-4.xlsx`) against the current exports reveals these issues:

**Critical — Data bugs:**
1. **All weights show 0** — `buildSyntheticQuote` only reads `weight_kg`/`weight_lbs` from bar_lines but the AI pipeline doesn't compute those (LLM forbidden from arithmetic). Weights must be calculated using `qty × multiplier × length × unit_weight` via `getMassKgPerM`.
2. **Size breakdown empty** — Because weights are 0, the left "Weight Summary" table has no bar size rows.

**Layout/formatting gaps vs reference:**
3. **Missing header fields** — Reference has "Estimator" and "Created Date" columns. Current export lacks these.
4. **Sub-element headers missing detail** — Reference shows "SLAB S1-16" THK", "FOUNDATION WALLS", etc. Current only shows top-level element type.
5. **Notes section** — Reference has a structured lap length table per bar diameter (10M: 320mm/420mm, 15M: 400mm/620mm, 20M: 640mm/830mm). Current shows generic text.
6. **Excel has no colors/borders** — Reference has colored header rows, bordered cells. The `xlsx` community library has limited styling, but we can apply basic cell styles.

### Changes

#### 1. Fix weight calculation in `buildSyntheticQuote` (ChatArea.tsx)

Compute weight using `getMassKgPerM` when `weight_kg` is missing:

```typescript
import { getMassKgPerM } from "@/lib/rebar-weights";

// Inside buildSyntheticQuote, for each bar:
const lengthMm = b.length_mm || (b.length_ft ? b.length_ft * 304.8 : 0);
const mult = b.multiplier || 1;
const qty = b.qty || 0;
const totalLenM = (qty * mult * lengthMm) / 1000;
const massKgM = getMassKgPerM(b.size || "");
const wt = typeof b.weight_kg === "number" && b.weight_kg > 0 
  ? b.weight_kg 
  : totalLenM * massKgM;
// Store computed weight back on bar object
bar.weight_kg = wt;
```

This single fix will populate weights throughout the entire export pipeline (both Excel and PDF).

#### 2. Add "Estimator" and "Created Date" to headers (excel-export.ts + pdf-export.ts)

Add `Estimator` field from `scopeData?.estimator` and `Created Date` from current date in both export files' header sections.

#### 3. Add Excel cell styling (excel-export.ts)

Apply basic styling using xlsx cell properties:
- Dark header row (`s: { fill, font }`) for table headers
- Bordered cells for data rows
- Bold for group headers and totals
- Number formatting for weight/length columns

Note: SheetJS community edition has limited style support in `writeFile`. We will use the `!cols` width settings and cell-level `z` (number format) properties that are supported, plus generate the header styling via background colors where possible.

#### 4. Enhance Notes section format (excel-export.ts + pdf-export.ts)

When `scopeData?.lapLengthTable` exists, render a structured table:
```
Bar Dia.   Bot Lap    Top Lap
10M        320mm      420mm
15M        400mm      620mm
20M        640mm      830mm
```
Fall back to the existing single-line format if no structured data.

#### 5. Pass sub-element descriptions through (excel-export.ts + pdf-export.ts)

Use `b.sub_element` or `b.description` for sub-group headers, preserving detail like "SLAB S1-16" THK" when present in the data.

### Files Modified
- `src/components/chat/ChatArea.tsx` — fix `buildSyntheticQuote` weight calculation
- `src/lib/excel-export.ts` — add estimator/date fields, cell styling, enhanced notes
- `src/lib/pdf-export.ts` — add estimator/date fields, enhanced notes

### No backend changes required

