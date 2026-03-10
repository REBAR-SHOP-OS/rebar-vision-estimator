

## Plan: PDF Export Weight Fix + Cover Page

### Problem 1: All weights show "0.0"

**Root cause** — Two locations use `typeof b.weight_kg === "number"` to prefer stored weight. When the backend sends `weight_kg: 0` (or doesn't compute it), this truthy check picks up the zero instead of calculating from length × mass.

- **Line 38** (element summary): `typeof b.weight_kg === "number" ? b.weight_kg : ...` → uses 0
- **Line 86** (bar list rows): same pattern → uses 0

Additionally, the size breakdown tables (`sizeBreakdownKg`, `sizeBreakdownLbs`) may be empty objects, causing the summary panel to show zero.

**Fix**: Change weight resolution to only use `b.weight_kg` if it's a **positive** number, otherwise compute from `totalLenM * massKgM`. Apply the same fix to the element summary loop. Also recompute summary totals from bar list data as a fallback when the breakdown objects are empty.

### Problem 2: No cover page

**Fix**: Add a full-page cover before the Estimate Summary section with:
- Company logo (large, centered)
- "REBAR ESTIMATION REPORT" title
- Project name, client, date, engineer
- Professional styling with page-break-after

### Changes — Single file: `src/lib/pdf-export.ts`

1. **Fix weight_kg fallback** (lines 38 and 86): Change `typeof b.weight_kg === "number"` to `(typeof b.weight_kg === "number" && b.weight_kg > 0)` so zero values trigger recomputation.

2. **Recompute size/element breakdowns from bar list** when the provided breakdown objects are empty — use the computed `wtKg` per bar to build accurate summaries.

3. **Add cover page HTML** before the Estimate Summary section — a centered full-page block with logo, title, and key project metadata, using `page-break-after: always`.

4. **Add CSS** for `.cover-page` styling.

### Scope
- 1 file: `src/lib/pdf-export.ts`
- ~50 lines changed/added
- No backend changes

