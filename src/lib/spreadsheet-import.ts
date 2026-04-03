import ExcelJS from "exceljs";

export type SpreadsheetCell = string | number | boolean | Date | null;

export interface SpreadsheetSheet {
  name: string;
  rows: SpreadsheetCell[][];
}

export interface SpreadsheetWorkbook {
  format: "xlsx" | "csv";
  sheets: SpreadsheetSheet[];
}

function isEmptyCell(value: SpreadsheetCell): boolean {
  return value === null || value === "";
}

function trimTrailingEmptyCells(row: SpreadsheetCell[]): SpreadsheetCell[] {
  let lastNonEmptyIndex = row.length - 1;
  while (lastNonEmptyIndex >= 0 && isEmptyCell(row[lastNonEmptyIndex])) {
    lastNonEmptyIndex--;
  }
  return row.slice(0, lastNonEmptyIndex + 1);
}

function normalizeFormulaResult(result: unknown): SpreadsheetCell {
  if (result === null || result === undefined) return null;
  if (
    typeof result === "string" ||
    typeof result === "number" ||
    typeof result === "boolean" ||
    result instanceof Date
  ) {
    return result;
  }
  return String(result);
}

function normalizeExcelCellValue(value: ExcelJS.CellValue | undefined): SpreadsheetCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((part) => ("text" in part ? part.text : "")).join("");
  }
  if (typeof value === "object") {
    if ("result" in value) return normalizeFormulaResult(value.result);
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("hyperlink" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("error" in value && typeof value.error === "string") return value.error;
  }
  return String(value);
}

function worksheetToRows(worksheet: ExcelJS.Worksheet): SpreadsheetCell[][] {
  const columnCount = Math.max(
    worksheet.actualColumnCount,
    ...Array.from({ length: worksheet.rowCount }, (_, index) => worksheet.getRow(index + 1).cellCount)
  );

  const rows: SpreadsheetCell[][] = [];
  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const values: SpreadsheetCell[] = [];
    for (let colIndex = 1; colIndex <= columnCount; colIndex++) {
      values.push(normalizeExcelCellValue(row.getCell(colIndex).value));
    }
    rows.push(trimTrailingEmptyCells(values));
  }

  return rows;
}

async function parseXlsxBuffer(data: ArrayBuffer): Promise<SpreadsheetWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  return {
    format: "xlsx",
    sheets: workbook.worksheets.map((worksheet) => ({
      name: worksheet.name,
      rows: worksheetToRows(worksheet),
    })),
  };
}

function parseCsvText(text: string): SpreadsheetWorkbook {
  const rows: SpreadsheetCell[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  const pushCell = () => {
    currentRow.push(currentCell);
    currentCell = "";
  };

  const pushRow = () => {
    rows.push(trimTrailingEmptyCells(currentRow.map((value) => value ?? null)));
    currentRow = [];
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        currentCell += "\"";
        index++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      pushCell();
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index++;
      pushCell();
      pushRow();
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    pushCell();
    pushRow();
  }

  return {
    format: "csv",
    sheets: [
      {
        name: "Sheet1",
        rows,
      },
    ],
  };
}

export async function readSpreadsheetFile(file: File): Promise<SpreadsheetWorkbook> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "csv") return parseCsvText(await file.text());
  if (ext === "xlsx") return parseXlsxBuffer(await file.arrayBuffer());
  if (ext === "xls") {
    throw new Error("Legacy .xls files are no longer supported for secure import. Please resave the file as .xlsx or .csv.");
  }

  throw new Error("Unsupported spreadsheet format. Use .xlsx or .csv files.");
}

function getHeaderName(value: SpreadsheetCell, index: number): string {
  const text = String(value ?? "").trim();
  return text || `__column_${index + 1}`;
}

export function isRowEmpty(row: SpreadsheetCell[]): boolean {
  return row.every((value) => isEmptyCell(value));
}

export function sheetToObjects(sheet: SpreadsheetSheet): Record<string, SpreadsheetCell>[] {
  const headerRowIndex = sheet.rows.findIndex((row) => !isRowEmpty(row));
  if (headerRowIndex < 0) return [];

  const headers = sheet.rows[headerRowIndex].map(getHeaderName);

  return sheet.rows
    .slice(headerRowIndex + 1)
    .filter((row) => !isRowEmpty(row))
    .map((row) => {
      const entry: Record<string, SpreadsheetCell> = {};
      headers.forEach((header, index) => {
        entry[header] = row[index] ?? null;
      });
      return entry;
    });
}

export function sheetToCsv(sheet: SpreadsheetSheet): string {
  return sheet.rows
    .map((row) =>
      row
        .map((value) => {
          const text = value === null ? "" : String(value);
          return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
        })
        .join(",")
    )
    .join("\n");
}
