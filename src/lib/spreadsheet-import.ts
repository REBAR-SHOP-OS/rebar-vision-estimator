import ExcelJS from "exceljs";

export interface SpreadsheetSheet {
  name: string;
  rows: unknown[][];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCellValue(value: unknown): unknown {
  if (value == null) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCellValue(item)).join(" ");
  }

  if (isPlainObject(value)) {
    if ("result" in value && value.result != null) {
      return normalizeCellValue(value.result);
    }

    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }

    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((chunk) =>
          isPlainObject(chunk) && typeof chunk.text === "string" ? chunk.text : "",
        )
        .join("");
    }

    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return typeof value.text === "string" ? value.text : value.hyperlink;
    }

    if ("formula" in value && typeof value.formula === "string") {
      return value.formula;
    }
  }

  return value;
}

function trimTrailingEmptyCells(row: unknown[]): unknown[] {
  let end = row.length;

  while (end > 0) {
    const value = row[end - 1];
    if (value !== "" && value != null) {
      break;
    }
    end -= 1;
  }

  return row.slice(0, end);
}

function trimTrailingEmptyRows(rows: unknown[][]): unknown[][] {
  let end = rows.length;

  while (end > 0) {
    const row = rows[end - 1] ?? [];
    if (row.some((value) => value !== "" && value != null)) {
      break;
    }
    end -= 1;
  }

  return rows.slice(0, end);
}

function worksheetToRows(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];

  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = Array.isArray(row.values)
      ? row.values.slice(1).map((value) => normalizeCellValue(value))
      : [];

    rows[rowNumber - 1] = trimTrailingEmptyCells(values);
  });

  return trimTrailingEmptyRows(rows);
}

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      currentRow.push(currentCell);
      rows.push(trimTrailingEmptyCells(currentRow) as string[]);
      currentRow = [];
      currentCell = "";

      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  rows.push(trimTrailingEmptyCells(currentRow) as string[]);

  return trimTrailingEmptyRows(rows) as string[][];
}

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsvText(rows: unknown[][]): string {
  return rows.map((row) => row.map((value) => csvEscape(value)).join(",")).join("\n");
}

export function sheetRowsToObjects(rows: unknown[][]): Record<string, unknown>[] {
  const headerIndex = rows.findIndex((row) =>
    row.some((value) => String(value ?? "").trim() !== ""),
  );

  if (headerIndex < 0) {
    return [];
  }

  const headers = rows[headerIndex].map((value, index) => {
    const label = String(value ?? "").trim();
    return label || `__EMPTY_${index}`;
  });

  return rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((value) => String(value ?? "").trim() !== ""))
    .map((row) => {
      const record: Record<string, unknown> = {};

      headers.forEach((header, index) => {
        const value = row[index];
        if (value !== undefined && value !== "") {
          record[header] = value;
        }
      });

      return record;
    });
}

export async function readSpreadsheetFile(file: File): Promise<SpreadsheetSheet[]> {
  const extension = file.name.toLowerCase().split(".").pop();

  if (extension === "csv") {
    return [
      {
        name: file.name,
        rows: parseCsvText(await file.text()),
      },
    ];
  }

  if (extension === "xls") {
    throw new Error(
      "Legacy .xls files are no longer supported after the security upgrade. Please re-save the file as .xlsx or .csv.",
    );
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  return workbook.worksheets.map((worksheet) => ({
    name: worksheet.name,
    rows: worksheetToRows(worksheet),
  }));
}
