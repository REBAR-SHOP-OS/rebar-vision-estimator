# Export Utilities

Centralize all Excel/PDF generation here. Components must NEVER build their own
export — they call into one of these libs. Keeps styling consistent and gives
you one place to enforce the validation gate before issuing.

## Files to copy from the reference app (and generalize)

- `src/lib/excel-export.ts` — ExcelJS, teal headers (`FF8DB4B4`), 2 primary + 3
  power-user sheets, mm→ft-in helper, frozen header rows.
- `src/lib/pdf-export.ts` — main report PDF.
- `src/lib/quote-pdf-export.ts` — customer-facing quote PDF.

## Conventions

- All currency cells: `$#,##0;($#,##0);-` (zero shows as dash).
- Frozen header row + autosized columns (max 60 char).
- Brand logo from `src/lib/logo-base64.ts` for inline embedding.
- Issued exports MUST call `validateDrawingMetadata(meta, "issued")` first and
  refuse to render if `ok === false`.

## Skeleton

```ts
import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 1 }] });
ws.columns = [{ header: "ID", width: 10 }, { header: "Item", width: 40 }];
ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF8DB4B4" } };
ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
const buf = await wb.xlsx.writeBuffer();
// trigger download with new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
```