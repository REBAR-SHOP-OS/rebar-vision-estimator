/**
 * Excel export — 2 primary sheets + 3 power-user sheets.
 * Uses ExcelJS for professional styling matching reference workbook.
 */
import ExcelJS from "exceljs";
import { getMassKgPerM } from "@/lib/rebar-weights";
import { getLogoBuffer } from "@/lib/logo-base64";

interface ExportParams {
  quoteResult: Record<string, unknown>;
  elements: unknown[];
  scopeData?: Record<string, unknown>;
}

// ── helpers ──────────────────────────────────────────────────────

function mmToFtIn(mm: number): string {
  if (!mm) return "";
  const totalInches = mm / 25.4;
  const ft = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return ft > 0 ? `${ft}'-${inches}"` : `${inches}"`;
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

function r1(v: number): number { return Math.round(v * 10) / 10; }
function r3(v: number): number { return Math.round(v * 1000) / 1000; }

// ── Style constants ─────────────────────────────────────────────

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" }, bottom: { style: "thin" },
  left: { style: "thin" }, right: { style: "thin" },
};

const TEAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF8DB4B4" } };
const GREEN_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF92D050" } };
const YELLOW_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
const LIGHT_GRAY_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
const SALMON_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
const LIGHT_YELLOW_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFCC" } };
const LIGHT_BLUE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } };

const BOLD_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11 };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, size: 12 };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14 };

// ── Sheet 1: Estimate Summary ───────────────────────────────────

function buildEstimateSummarySheet(wb: ExcelJS.Workbook, params: ExportParams) {
  const ws = wb.addWorksheet("Estimate Summary");
  const { quoteResult, scopeData } = params;
  const barList: any[] = (quoteResult.quote as Record<string, unknown>).bar_list as any[] || [];
  const sizeBreakdownKg: Record<string, number> = (quoteResult.quote as Record<string, unknown>).size_breakdown_kg as Record<string, number> || {};
  const sizeBreakdown: Record<string, number> = (quoteResult.quote as Record<string, unknown>).size_breakdown as Record<string, number> || {};
  const rawMeshDetails: any[] = (quoteResult.quote as Record<string, unknown>).mesh_details as any[] || (scopeData as Record<string, unknown>)?.meshDetails as any[] || [];
  // Extract WWM items from bar_list if mesh_details is empty
  const meshDetails: any[] = rawMeshDetails.length > 0 ? rawMeshDetails : barList
    .filter((b: any) => b.size && /\d.*x.*\d.*W/i.test(b.size as string))
    .map((b: any) => ({
      location: b.element_type || b.sub_element || "—",
      mesh_size: b.size,
      area_sqft: b.area_sqft || b.qty || "—",
    }));
  const recon = (quoteResult.quote as any).reconciliation || {};

  // Compute weight-by-size from bar_list (same source as element breakdown)
  const sizeWeights: Record<string, number> = {};
  for (const b of barList) {
    const sz = b.size || "OTHER";
    const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : (typeof b.weight_lbs === "number" ? b.weight_lbs * 0.453592 : 0);
    if (wtKg > 0) sizeWeights[sz] = (sizeWeights[sz] || 0) + wtKg;
  }
  const sizeEntries: [string, number][] = Object.entries(sizeWeights);
  sizeEntries.sort((a, b) => parseInt(a[0].replace(/[^0-9]/g, "")) - parseInt(b[0].replace(/[^0-9]/g, "")));

  // Compute weight-by-element
  const elemWeights: Record<string, number> = {};
  for (const b of barList) {
    const t = b.element_type || "OTHER";
    const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : (typeof b.weight_lbs === "number" ? b.weight_lbs * 0.453592 : 0);
    elemWeights[t] = (elemWeights[t] || 0) + wtKg;
  }
  const elemEntries = Object.entries(elemWeights).sort((a, b) => b[1] - a[1]);

  // Compute totalKg from actual visible data instead of stale AI value
  const computedKg = elemEntries.reduce((s, e) => s + e[1], 0) || sizeEntries.reduce((s, e) => s + e[1], 0);
  const totalKg = computedKg > 0 ? computedKg : (recon.drawing_based_total || quoteResult.quote.total_weight_kg || (quoteResult.quote.total_weight_lbs ? quoteResult.quote.total_weight_lbs * 0.453592 : 0));
  const totalTons = totalKg / 1000;

  // Column widths
  ws.columns = [
    { width: 22 }, { width: 16 }, { width: 6 }, { width: 6 }, { width: 6 },
    { width: 8 }, { width: 24 }, { width: 16 },
  ];

  let rowNum = 1;

  // ── Project header (rows 1-4, teal background)
  const headerData = [
    ["Project Name:", scopeData?.projectName || "—", "", "", "", "Product Line:", scopeData?.productLine || "Rebar"],
    ["Address:", scopeData?.address || "—", "", "", "", "Engineer:", scopeData?.engineer || "—"],
    ["Customer:", scopeData?.clientName || "—", "", "", "", "Estimator:", scopeData?.estimator || "—"],
    ["Created Date:", new Date().toLocaleDateString(), "", "", "", "", ""],
  ];
  for (const hd of headerData) {
    const row = ws.addRow(hd);
    row.eachCell((cell) => {
      cell.fill = TEAL_FILL;
      cell.font = BOLD_FONT;
      cell.border = THIN_BORDER;
    });
    rowNum++;
  }

  // Empty row
  ws.addRow([]); rowNum++;

  // ── Warning banner
  const isBlocked = quoteResult.quote.job_status === "VALIDATION_FAILED" || quoteResult.quote.job_status === "BLOCKED";
  const isFlagged = (recon.risk_level === "FLAG") || quoteResult.quote.job_status === "FLAGGED";
  if (isBlocked || isFlagged) {
    const msg = isBlocked
      ? "⚠ WARNING: Estimate status is BLOCKED — results may be incomplete or invalid"
      : "⚠ NOTICE: Estimate flagged for review — verify before final use";
    const row = ws.addRow([msg]);
    ws.mergeCells(rowNum, 1, rowNum, 8);
    row.getCell(1).font = { bold: true, color: { argb: "FFFF0000" }, size: 11 };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    rowNum++;
    ws.addRow([]); rowNum++;
  }

  // ── Title banner
  const titleRow = ws.addRow(["ESTIMATE SUMMARY"]);
  ws.mergeCells(rowNum, 1, rowNum, 8);
  titleRow.getCell(1).font = { ...TITLE_FONT, color: { argb: "FFFFFFFF" } };
  titleRow.getCell(1).fill = GREEN_FILL;
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  titleRow.height = 28;
  rowNum++;

  ws.addRow([]); rowNum++;

  // ── Side-by-side table headers
  const subTitleRow = ws.addRow(["Weight Summary Report in Kgs", "", "", "", "", "Element wise Summary Report in Kgs", "", ""]);
  subTitleRow.getCell(1).font = { bold: true, underline: true, size: 11 };
  subTitleRow.getCell(6).font = { bold: true, underline: true, size: 11 };
  rowNum++;

  const colHeaderRow = ws.addRow(["Bar Size", "Weight (kg)", "", "", "", "SL.No.", "Element", "Weight (kg)"]);
  [1, 2, 6, 7, 8].forEach((c) => {
    colHeaderRow.getCell(c).fill = LIGHT_GRAY_FILL;
    colHeaderRow.getCell(c).font = BOLD_FONT;
    colHeaderRow.getCell(c).border = THIN_BORDER;
  });
  rowNum++;

  // ── Data rows
  const maxRows = Math.max(sizeEntries.length, elemEntries.length);
  for (let i = 0; i < maxRows; i++) {
    const sizeCol = sizeEntries[i] ? [sizeEntries[i][0], r1(sizeEntries[i][1])] : ["", ""];
    const elemCol = elemEntries[i] ? [i + 1, elemEntries[i][0], r1(elemEntries[i][1])] : ["", "", ""];
    const row = ws.addRow([sizeCol[0], sizeCol[1], "", "", "", elemCol[0], elemCol[1], elemCol[2]]);
    [1, 2, 6, 7, 8].forEach((c) => {
      row.getCell(c).border = THIN_BORDER;
    });
    row.getCell(2).alignment = { horizontal: "right" };
    row.getCell(8).alignment = { horizontal: "right" };
    rowNum++;
  }

  // ── Grand totals (yellow)
  const totalRow1 = ws.addRow(["Grand Total (kg)", r1(totalKg), "", "", "", "", "Grand Total (kg)", r1(totalKg)]);
  const totalRow2 = ws.addRow(["Grand Total (Tons)", r3(totalTons), "", "", "", "", "Grand Total (Tons)", r3(totalTons)]);
  [totalRow1, totalRow2].forEach((row) => {
    [1, 2, 7, 8].forEach((c) => {
      row.getCell(c).fill = YELLOW_FILL;
      row.getCell(c).font = BOLD_FONT;
      row.getCell(c).border = THIN_BORDER;
    });
    row.getCell(2).alignment = { horizontal: "right" };
    row.getCell(8).alignment = { horizontal: "right" };
  });
  rowNum += 2;

  ws.addRow([]); rowNum++;

  // ── NOTES section
  const notesHeader = ws.addRow(["NOTES"]);
  ws.mergeCells(rowNum, 1, rowNum, 8);
  notesHeader.getCell(1).font = HEADER_FONT;
  notesHeader.getCell(1).fill = GREEN_FILL;
  rowNum++;

  const riskFlags: string[] = quoteResult.quote.risk_flags || [];
  ws.addRow(["Grade:", scopeData?.grade || "As per drawing"]).getCell(1).font = BOLD_FONT; rowNum++;
  ws.addRow(["Deviations:", scopeData?.deviations || quoteResult.quote.deviations || "None noted"]).getCell(1).font = BOLD_FONT; rowNum++;
  ws.addRow(["Coating:", scopeData?.coating || "Uncoated"]).getCell(1).font = BOLD_FONT; rowNum++;

  // Lap length table
  const lapTable = scopeData?.lapLengthTable;
  if (lapTable && Array.isArray(lapTable) && lapTable.length > 0) {
    ws.addRow([]); rowNum++;
    const lapHeader = ws.addRow(["Lap Length Details"]);
    lapHeader.getCell(1).font = { bold: true, underline: true, size: 11 };
    rowNum++;
    const lapColRow = ws.addRow(["Bar Dia.", "Bot Lap", "Top Lap"]);
    [1, 2, 3].forEach((c) => {
      lapColRow.getCell(c).fill = LIGHT_GRAY_FILL;
      lapColRow.getCell(c).font = BOLD_FONT;
      lapColRow.getCell(c).border = THIN_BORDER;
    });
    rowNum++;
    for (const lt of lapTable) {
      const r = ws.addRow([lt.size || "", lt.bot_lap || "", lt.top_lap || ""]);
      [1, 2, 3].forEach((c) => { r.getCell(c).border = THIN_BORDER; });
      rowNum++;
    }
  } else {
    ws.addRow(["Lap Length Info:", scopeData?.lapLengthInfo || "Standard laps as per code"]).getCell(1).font = BOLD_FONT;
    rowNum++;
  }

  if (riskFlags.length > 0) {
    for (const f of riskFlags) {
      const r = ws.addRow(["⚠ " + f]);
      r.getCell(1).font = { bold: true, color: { argb: "FFFF0000" } };
      rowNum++;
    }
  }

  ws.addRow([]); rowNum++;

  // ── MESH DETAILS
  const meshHeader = ws.addRow(["MESH DETAILS"]);
  ws.mergeCells(rowNum, 1, rowNum, 8);
  meshHeader.getCell(1).font = HEADER_FONT;
  meshHeader.getCell(1).fill = GREEN_FILL;
  rowNum++;

  const meshColRow = ws.addRow(["Location", "Mesh Size", "Total Area (SQFT)"]);
  [1, 2, 3].forEach((c) => {
    meshColRow.getCell(c).fill = LIGHT_GRAY_FILL;
    meshColRow.getCell(c).font = BOLD_FONT;
    meshColRow.getCell(c).border = THIN_BORDER;
  });
  rowNum++;

  if (meshDetails.length > 0) {
    for (const m of meshDetails) {
      const r = ws.addRow([m.location || m.area || "—", m.mesh_size || m.sheet_type || "—", m.area_sqft || m.total_area || "—"]);
      [1, 2, 3].forEach((c) => { r.getCell(c).border = THIN_BORDER; });
    }
  } else {
    const r = ws.addRow(["N/A", "", ""]);
    [1, 2, 3].forEach((c) => { r.getCell(c).border = THIN_BORDER; });
  }
}

// ── Sheet 2: Bar List ───────────────────────────────────────────

function buildBarListSheet(wb: ExcelJS.Workbook, params: ExportParams) {
  const ws = wb.addWorksheet("Bar List");
  const { quoteResult, scopeData } = params;
  const barList: any[] = quoteResult.quote.bar_list || [];
  const meshDetails: any[] = quoteResult.quote.mesh_details || scopeData?.meshDetails || [];

  const headers = [
    "SL.No.", "Identification", "Multiplier", "Qty", "Bar Dia",
    "Length ft-in", "Length mm", "Bend", "Info 1", "Info 2/@",
    "Total Length (Mtr.)", "Total Wgt kg", "Notes",
  ];

  // Column widths
  ws.columns = [
    { width: 8 }, { width: 30 }, { width: 10 }, { width: 8 }, { width: 10 },
    { width: 12 }, { width: 12 }, { width: 8 }, { width: 10 }, { width: 10 },
    { width: 16 }, { width: 14 }, { width: 14 },
  ];

  let rowNum = 1;

  // Project header
  const projRow = ws.addRow([`Project: ${scopeData?.projectName || "—"}`, "", "", "", "", "", "", "", "", "", "", `Date: ${new Date().toLocaleDateString()}`, ""]);
  ws.mergeCells(rowNum, 1, rowNum, 6);
  projRow.getCell(1).font = HEADER_FONT;
  projRow.getCell(1).fill = TEAL_FILL;
  for (let c = 1; c <= 13; c++) { projRow.getCell(c).fill = TEAL_FILL; }
  rowNum++;

  ws.addRow([]); rowNum++;

  // Column headers (salmon fill)
  const hdrRow = ws.addRow(headers);
  hdrRow.eachCell((cell) => {
    cell.fill = SALMON_FILL;
    cell.font = BOLD_FONT;
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  hdrRow.height = 30;
  rowNum++;

  // Group bars by element_type
  const grouped = groupBy(barList, (b) => b.element_type || "OTHER");
  let slNo = 1;
  let grandTotalLenM = 0;
  let grandTotalWtKg = 0;

  for (const [elemType, bars] of Object.entries(grouped)) {
    // Element type header (bold, yellow fill, merged)
    const elemRow = ws.addRow([elemType.toUpperCase()]);
    ws.mergeCells(rowNum, 1, rowNum, 13);
    elemRow.getCell(1).font = { bold: true, size: 11 };
    elemRow.getCell(1).fill = YELLOW_FILL;
    elemRow.getCell(1).border = THIN_BORDER;
    rowNum++;

    // Sub-group by sub_element
    const subGrouped = groupBy(bars, (b) => b.sub_element || b.description || "");
    for (const [subElem, subBars] of Object.entries(subGrouped)) {
      if (subElem && Object.keys(subGrouped).length > 1) {
        const subRow = ws.addRow(["", subElem.toUpperCase()]);
        ws.mergeCells(rowNum, 2, rowNum, 13);
        subRow.getCell(2).font = { bold: true, size: 10 };
        subRow.getCell(2).fill = LIGHT_BLUE_FILL;
        for (let c = 1; c <= 13; c++) { subRow.getCell(c).border = THIN_BORDER; }
        rowNum++;
      }

      for (const b of subBars) {
        const lengthMm = b.length_mm || (b.length_ft ? b.length_ft * 304.8 : 0);
        const massKgM = getMassKgPerM(b.size);
        const multiplier = b.multiplier || 1;
        const qty = b.qty || 0;
        const totalPieces = qty * multiplier;
        // Prefer AI-provided weight_kg; back-calculate length for display
        const calcLenM = (totalPieces * lengthMm) / 1000;
        const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : calcLenM * massKgM;
        const totalLenM = (typeof b.weight_kg === "number" && massKgM > 0) ? b.weight_kg / massKgM : calcLenM;

        const identification = [b.size, b.spacing ? `@ ${b.spacing}` : "", b.bar_mark || b.description || ""].filter(Boolean).join(" ");

        grandTotalLenM += totalLenM;
        grandTotalWtKg += wtKg;

        const dataRow = ws.addRow([
          slNo++,
          identification,
          multiplier,
          qty,
          b.size || "",
          mmToFtIn(lengthMm),
          Math.round(lengthMm),
          b.bend_type || b.bend || "",
          b.info1 || "",
          b.info2 || b.spacing || "",
          r3(totalLenM),
          r1(wtKg),
          b.notes || b.status || "",
        ]);
        dataRow.eachCell((cell, colNumber) => {
          cell.border = THIN_BORDER;
          if ([1, 3, 4, 7, 11, 12].includes(colNumber)) {
            cell.alignment = { horizontal: "right" };
          }
        });
        rowNum++;
      }
    }
  }

  // Footer totals
  ws.addRow([]); rowNum++;

  const totalRow = ws.addRow(["", "TOTAL WEIGHT", "", "", "", "", "", "", "", "", r3(grandTotalLenM), r1(grandTotalWtKg), ""]);
  totalRow.eachCell((cell) => {
    cell.fill = YELLOW_FILL;
    cell.font = BOLD_FONT;
    cell.border = THIN_BORDER;
  });
  rowNum++;

  const tonsRow = ws.addRow(["", "TOTAL (Tons)", "", "", "", "", "", "", "", "", "", r3(grandTotalWtKg / 1000), ""]);
  tonsRow.eachCell((cell) => {
    cell.fill = YELLOW_FILL;
    cell.font = BOLD_FONT;
    cell.border = THIN_BORDER;
  });
  rowNum++;

  ws.addRow([]); rowNum++;

  // Mesh details
  if (meshDetails.length > 0) {
    const meshHdr = ws.addRow(["MESH DETAILS"]);
    ws.mergeCells(rowNum, 1, rowNum, 13);
    meshHdr.getCell(1).font = HEADER_FONT;
    meshHdr.getCell(1).fill = GREEN_FILL;
    rowNum++;

    const meshColRow = ws.addRow(["Location", "Mesh Size", "Total Area (SQFT)"]);
    [1, 2, 3].forEach((c) => {
      meshColRow.getCell(c).fill = LIGHT_GRAY_FILL;
      meshColRow.getCell(c).font = BOLD_FONT;
      meshColRow.getCell(c).border = THIN_BORDER;
    });
    rowNum++;

    for (const m of meshDetails) {
      const r = ws.addRow([m.location || m.area || "—", m.mesh_size || m.sheet_type || "—", m.area_sqft || m.total_area || "—"]);
      [1, 2, 3].forEach((c) => { r.getCell(c).border = THIN_BORDER; });
    }
  }
}

// ── Sheet 3: Reconciliation ─────────────────────────────────────

function buildReconciliationSheet(wb: ExcelJS.Workbook, params: ExportParams) {
  const ws = wb.addWorksheet("Reconciliation");
  const { quoteResult } = params;
  const recon = quoteResult.quote.reconciliation || {};
  const barList: any[] = quoteResult.quote.bar_list || [];

  ws.columns = [{ width: 20 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 22 }, { width: 24 }];

  const hdrRow = ws.addRow(["Element", "Drawing Weight (kg)", "Norm Weight (kg)", "Variance (%)", "Reconciliation Status", "Notes"]);
  hdrRow.eachCell((cell) => {
    cell.fill = LIGHT_GRAY_FILL;
    cell.font = BOLD_FONT;
    cell.border = THIN_BORDER;
  });

  const elemRecon: any[] = recon.element_reconciliation || [];
  let firstDataRow = 0;
  let lastDataRow = 0;
  const addDataRow = (values: any[]) => {
    const r = ws.addRow(values);
    const currentRow = ws.rowCount;
    if (!firstDataRow) firstDataRow = currentRow;
    lastDataRow = currentRow;
    r.eachCell((cell) => { cell.border = THIN_BORDER; });
  };

  if (elemRecon.length > 0) {
    for (const er of elemRecon) {
      addDataRow([er.element || "", er.drawing_weight != null ? r1(er.drawing_weight) : "", er.norm_weight != null ? r1(er.norm_weight) : "", er.variance_percent != null ? r1(er.variance_percent) : "", er.status || "", er.notes || ""]);
    }
  } else {
    const elemWeights: Record<string, number> = {};
    for (const b of barList) {
      const t = b.element_type || "OTHER";
      const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : 0;
      elemWeights[t] = (elemWeights[t] || 0) + wtKg;
    }
    for (const [elem, wt] of Object.entries(elemWeights)) {
      addDataRow([elem, r1(wt), "", "", "", ""]);
    }
  }

  ws.addRow([]);
  const hasSumRange = firstDataRow > 0 && lastDataRow > 0;
  const totalRow = ws.addRow([
    "TOTAL",
    hasSumRange ? { formula: `SUM(B${firstDataRow}:B${lastDataRow})` } : "",
    hasSumRange ? { formula: `SUM(C${firstDataRow}:C${lastDataRow})` } : "",
    recon.variance_pct != null ? r1(recon.variance_pct) : "",
    recon.risk_level || "",
    "",
  ]);
  totalRow.eachCell((cell) => {
    cell.fill = YELLOW_FILL;
    cell.font = BOLD_FONT;
    cell.border = THIN_BORDER;
  });
}

// ── Sheet 4: Audit Trace ────────────────────────────────────────

function buildAuditTraceSheet(wb: ExcelJS.Workbook, params: ExportParams) {
  const ws = wb.addWorksheet("Audit Trace");
  const { quoteResult } = params;
  const auditTrace = quoteResult.quote.audit_trace || {};

  ws.columns = [{ width: 16 }, { width: 16 }, { width: 40 }, { width: 40 }, { width: 24 }];

  const hdrRow = ws.addRow(["Stage", "Stage Status", "Input Hash", "Output Hash", "Timestamp"]);
  hdrRow.eachCell((cell) => {
    cell.fill = LIGHT_GRAY_FILL;
    cell.font = BOLD_FONT;
    cell.border = THIN_BORDER;
  });

  const stageHashes: any[] = auditTrace.stage_hashes || [];
  if (stageHashes.length > 0) {
    for (let i = 0; i < stageHashes.length; i++) {
      const h = stageHashes[i];
      if (typeof h === "object" && h !== null) {
        ws.addRow([h.stage || `Stage ${i}`, h.status || "", h.input_hash || "", h.output_hash || h.hash || "", h.timestamp || ""]);
      } else {
        ws.addRow([`Stage ${i}`, "", "", typeof h === "string" ? h : "", ""]);
      }
    }
  } else {
    ws.addRow(["No audit trace data available", "", "", "", ""]);
  }
}

// ── Sheet 5: Raw JSON ───────────────────────────────────────────

function buildRawJsonSheet(wb: ExcelJS.Workbook, params: ExportParams) {
  const ws = wb.addWorksheet("Raw JSON");
  ws.columns = [{ width: 120 }];

  const hdr = ws.addRow(["Raw JSON Output"]);
  hdr.getCell(1).font = BOLD_FONT;

  const jsonStr = JSON.stringify(params.quoteResult, null, 2);
  const lines = jsonStr.split("\n");
  for (const line of lines) ws.addRow([line]);
}

// ── Main export function ────────────────────────────────────────

export async function exportExcelFile(params: ExportParams) {
  const { scopeData } = params;
  const wb = new ExcelJS.Workbook();

  // Add logo to workbook
  try {
    const logoBuffer = await getLogoBuffer();
    const logoId = wb.addImage({ buffer: logoBuffer, extension: "png" });
    // Will be placed on Estimate Summary sheet after it's built
    buildEstimateSummarySheet(wb, params);
    const ws = wb.getWorksheet("Estimate Summary");
    if (ws) {
      ws.addImage(logoId, {
        tl: { col: 7, row: 0 },
        ext: { width: 60, height: 60 },
      });
    }
  } catch {
    buildEstimateSummarySheet(wb, params);
  }

  buildBarListSheet(wb, params);
  buildReconciliationSheet(wb, params);
  buildAuditTraceSheet(wb, params);
  buildRawJsonSheet(wb, params);

  const projectSlug = (scopeData?.projectName || "rebar-takeoff").replace(/\s+/g, "_");

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectSlug}_estimate_export.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
