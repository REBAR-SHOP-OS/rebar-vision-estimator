/**
 * Excel export — 2 primary sheets matching reference workbook format,
 * plus 3 optional power-user sheets.
 */
import * as XLSX from "xlsx";
import { getMassKgPerM } from "@/lib/rebar-weights";

interface ExportParams {
  quoteResult: any;
  elements: any[];
  scopeData?: any;
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

// ── Sheet 1: Estimate Summary ───────────────────────────────────

function buildEstimateSummarySheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult, scopeData } = params;
  const barList: any[] = quoteResult.quote.bar_list || [];
  const sizeBreakdownKg: Record<string, number> = quoteResult.quote.size_breakdown_kg || {};
  const sizeBreakdown: Record<string, number> = quoteResult.quote.size_breakdown || {};
  const meshDetails: any[] = quoteResult.quote.mesh_details || scopeData?.meshDetails || [];
  const recon = quoteResult.quote.reconciliation || {};

  // Compute weight-by-size
  const hasSizeKg = Object.keys(sizeBreakdownKg).length > 0;
  const allSizes = new Set([...Object.keys(sizeBreakdownKg), ...Object.keys(sizeBreakdown)]);
  const sizeEntries: [string, number][] = [];
  for (const size of allSizes) {
    const kg = hasSizeKg
      ? (sizeBreakdownKg[size] || (sizeBreakdown[size] || 0) * 0.453592)
      : (sizeBreakdown[size] || 0) * 0.453592;
    if (kg > 0) sizeEntries.push([size, kg]);
  }
  sizeEntries.sort((a, b) => parseInt(a[0].replace(/[^0-9]/g, "")) - parseInt(b[0].replace(/[^0-9]/g, "")));

  // Compute weight-by-element
  const elemWeights: Record<string, number> = {};
  for (const b of barList) {
    const t = b.element_type || "OTHER";
    const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : (typeof b.weight_lbs === "number" ? b.weight_lbs * 0.453592 : 0);
    elemWeights[t] = (elemWeights[t] || 0) + wtKg;
  }
  const elemEntries = Object.entries(elemWeights).sort((a, b) => b[1] - a[1]);

  const totalKg = recon.drawing_based_total || quoteResult.quote.total_weight_kg || (quoteResult.quote.total_weight_lbs ? quoteResult.quote.total_weight_lbs * 0.453592 : 0);
  const totalTons = totalKg / 1000;

  // Determine max rows for side-by-side tables
  const maxRows = Math.max(sizeEntries.length, elemEntries.length);

  const rows: any[][] = [];
  const merges: XLSX.Range[] = [];

  // Row 0: Project header
  rows.push(["Project Name:", scopeData?.projectName || "—", "", "", "", "Product Line:", scopeData?.productLine || "Rebar"]);
  rows.push(["Address:", scopeData?.address || "—", "", "", "", "Engineer:", scopeData?.engineer || "—"]);
  rows.push(["Customer:", scopeData?.clientName || "—", "", "", "", "Estimator:", scopeData?.estimator || "—"]);
  rows.push(["Created Date:", new Date().toLocaleDateString()]);
  rows.push([]);

  // Warning banner if blocked/flagged
  const isBlocked = quoteResult.quote.job_status === "VALIDATION_FAILED" || quoteResult.quote.job_status === "BLOCKED";
  const isFlagged = (recon.risk_level === "FLAG") || quoteResult.quote.job_status === "FLAGGED";
  if (isBlocked) {
    rows.push(["⚠ WARNING: Estimate status is BLOCKED — results may be incomplete or invalid"]);
    merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 7 } });
    rows.push([]);
  } else if (isFlagged) {
    rows.push(["⚠ NOTICE: Estimate flagged for review — verify before final use"]);
    merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 7 } });
    rows.push([]);
  }

  // Title row
  const titleRow = rows.length;
  rows.push(["ESTIMATE SUMMARY"]);
  merges.push({ s: { r: titleRow, c: 0 }, e: { r: titleRow, c: 7 } });
  rows.push([]);

  // Side-by-side table headers
  const tableHeaderRow = rows.length;
  rows.push(["Weight Summary Report in Kgs", "", "", "", "", "Element wise Summary Report in Kgs", "", ""]);
  rows.push(["Bar Size", "Weight (kg)", "", "", "", "SL.No.", "Element", "Weight (kg)"]);

  // Side-by-side data rows
  for (let i = 0; i < maxRows; i++) {
    const sizeCol = sizeEntries[i] ? [sizeEntries[i][0], r1(sizeEntries[i][1])] : ["", ""];
    const elemCol = elemEntries[i] ? [i + 1, elemEntries[i][0], r1(elemEntries[i][1])] : ["", "", ""];
    rows.push([sizeCol[0], sizeCol[1], "", "", "", elemCol[0], elemCol[1], elemCol[2]]);
  }

  // Grand totals
  rows.push(["Grand Total (kg)", r1(totalKg), "", "", "", "", "Grand Total (kg)", r1(totalKg)]);
  rows.push(["Grand Total (Tons)", r3(totalTons), "", "", "", "", "Grand Total (Tons)", r3(totalTons)]);
  rows.push([]);

  // NOTES
  rows.push(["NOTES"]);
  const riskFlags: string[] = quoteResult.quote.risk_flags || [];
  rows.push(["Grade:", scopeData?.grade || "As per drawing"]);
  rows.push(["Lap Length Info:", scopeData?.lapLengthInfo || "Standard laps as per code"]);
  rows.push(["Deviations:", scopeData?.deviations || quoteResult.quote.deviations || "None noted"]);
  rows.push(["Coating:", scopeData?.coating || "Uncoated"]);
  if (riskFlags.length > 0) {
    for (const f of riskFlags) rows.push(["⚠ " + f]);
  }
  rows.push([]);

  // MESH DETAILS
  rows.push(["MESH DETAILS"]);
  rows.push(["Location", "Mesh Size", "Total Area (SQFT)"]);
  if (meshDetails.length > 0) {
    for (const m of meshDetails) {
      rows.push([m.location || m.area || "—", m.mesh_size || m.sheet_type || "—", m.area_sqft || m.total_area || "—"]);
    }
  } else {
    rows.push(["N/A", "", ""]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 22 }, { wch: 16 }, { wch: 4 }, { wch: 4 }, { wch: 4 },
    { wch: 8 }, { wch: 24 }, { wch: 16 },
  ];
  return ws;
}

// ── Sheet 2: Bar List ───────────────────────────────────────────

function buildBarListSheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult, scopeData } = params;
  const barList: any[] = quoteResult.quote.bar_list || [];
  const meshDetails: any[] = quoteResult.quote.mesh_details || scopeData?.meshDetails || [];

  const headers = [
    "SL.No.", "Identification", "Multiplier", "Qty", "Bar Dia",
    "Length ft-in", "Length mm", "Bend", "Info 1", "Info 2/@",
    "Total Length (Mtr.)", "Total Wgt kg", "Notes",
  ];

  const rows: any[][] = [];
  const merges: XLSX.Range[] = [];

  // Project header
  rows.push([`Project: ${scopeData?.projectName || "—"}`, "", "", "", "", "", "", "", "", "", "", `Date: ${new Date().toLocaleDateString()}`, ""]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } });
  rows.push([]);

  // Column headers
  rows.push(headers);

  // Group bars by element_type
  const grouped = groupBy(barList, (b) => b.element_type || "OTHER");
  let slNo = 1;
  let grandTotalLenM = 0;
  let grandTotalWtKg = 0;

  for (const [elemType, bars] of Object.entries(grouped)) {
    // Element type header row
    const groupHeaderIdx = rows.length;
    rows.push([elemType.toUpperCase()]);
    merges.push({ s: { r: groupHeaderIdx, c: 0 }, e: { r: groupHeaderIdx, c: 12 } });

    // Sub-group by sub_element if available
    const subGrouped = groupBy(bars, (b) => b.sub_element || b.description || "");
    for (const [subElem, subBars] of Object.entries(subGrouped)) {
      if (subElem && Object.keys(subGrouped).length > 1) {
        const subHeaderIdx = rows.length;
        rows.push(["", subElem.toUpperCase()]);
        merges.push({ s: { r: subHeaderIdx, c: 1 }, e: { r: subHeaderIdx, c: 12 } });
      }

      for (const b of subBars) {
        const lengthMm = b.length_mm || (b.length_ft ? b.length_ft * 304.8 : 0);
        const massKgM = getMassKgPerM(b.size);
        const multiplier = b.multiplier || 1;
        const qty = b.qty || 0;
        const totalPieces = qty * multiplier;
        const totalLenM = (totalPieces * lengthMm) / 1000;
        const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : totalLenM * massKgM;

        const identification = [b.size, b.spacing ? `@ ${b.spacing}` : "", b.bar_mark || b.description || ""].filter(Boolean).join(" ");

        grandTotalLenM += totalLenM;
        grandTotalWtKg += wtKg;

        rows.push([
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
      }
    }
  }

  // Footer totals
  rows.push([]);
  const totalRowIdx = rows.length;
  rows.push(["", "TOTAL WEIGHT", "", "", "", "", "", "", "", "", r3(grandTotalLenM), r1(grandTotalWtKg), ""]);
  rows.push(["", "TOTAL (Tons)", "", "", "", "", "", "", "", "", "", r3(grandTotalWtKg / 1000), ""]);
  rows.push([]);

  // Mesh details at bottom
  if (meshDetails.length > 0) {
    const meshHeaderIdx = rows.length;
    rows.push(["MESH DETAILS"]);
    merges.push({ s: { r: meshHeaderIdx, c: 0 }, e: { r: meshHeaderIdx, c: 12 } });
    rows.push(["Location", "Mesh Size", "Total Area (SQFT)"]);
    for (const m of meshDetails) {
      rows.push([m.location || m.area || "—", m.mesh_size || m.sheet_type || "—", m.area_sqft || m.total_area || "—"]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 8 }, { wch: 30 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
    { wch: 16 }, { wch: 14 }, { wch: 14 },
  ];
  return ws;
}

// ── Sheet 4: Reconciliation (power-user) ────────────────────────

function buildReconciliationSheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult } = params;
  const recon = quoteResult.quote.reconciliation || {};
  const barList: any[] = quoteResult.quote.bar_list || [];

  const rows: any[][] = [];
  rows.push(["Element", "Drawing Weight (kg)", "Norm Weight (kg)", "Variance (%)", "Reconciliation Status", "Notes"]);

  const elemRecon: any[] = recon.element_reconciliation || [];
  if (elemRecon.length > 0) {
    for (const er of elemRecon) {
      rows.push([er.element || "", er.drawing_weight != null ? r1(er.drawing_weight) : "", er.norm_weight != null ? r1(er.norm_weight) : "", er.variance_percent != null ? r1(er.variance_percent) : "", er.status || "", er.notes || ""]);
    }
  } else {
    const elemWeights: Record<string, number> = {};
    for (const b of barList) {
      const t = b.element_type || "OTHER";
      const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : 0;
      elemWeights[t] = (elemWeights[t] || 0) + wtKg;
    }
    for (const [elem, wt] of Object.entries(elemWeights)) {
      rows.push([elem, r1(wt), "", "", "", ""]);
    }
  }

  rows.push([]);
  rows.push(["TOTAL", recon.drawing_based_total ? r1(recon.drawing_based_total) : "", recon.industry_norm_total ? r1(recon.industry_norm_total) : "", recon.variance_pct != null ? r1(recon.variance_pct) : "", recon.risk_level || "", ""]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 24 }];
  return ws;
}

// ── Sheet 5: Audit Trace (power-user) ───────────────────────────

function buildAuditTraceSheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult } = params;
  const auditTrace = quoteResult.quote.audit_trace || {};
  const rows: any[][] = [["Stage", "Stage Status", "Input Hash", "Output Hash", "Timestamp"]];
  const stageHashes: any[] = auditTrace.stage_hashes || [];
  if (stageHashes.length > 0) {
    for (let i = 0; i < stageHashes.length; i++) {
      const h = stageHashes[i];
      if (typeof h === "object" && h !== null) {
        rows.push([h.stage || `Stage ${i}`, h.status || "", h.input_hash || "", h.output_hash || h.hash || "", h.timestamp || ""]);
      } else {
        rows.push([`Stage ${i}`, "", "", typeof h === "string" ? h : "", ""]);
      }
    }
  } else {
    rows.push(["No audit trace data available", "", "", "", ""]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 40 }, { wch: 40 }, { wch: 24 }];
  return ws;
}

// ── Sheet 6: Raw JSON (power-user) ──────────────────────────────

function buildRawJsonSheet(params: ExportParams): XLSX.WorkSheet {
  const jsonStr = JSON.stringify(params.quoteResult, null, 2);
  const lines = jsonStr.split("\n");
  const rows: any[][] = [["Raw JSON Output"]];
  for (const line of lines) rows.push([line]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 120 }];
  return ws;
}

// ── Main export function ────────────────────────────────────────

export function exportExcelFile(params: ExportParams) {
  const { scopeData } = params;
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildEstimateSummarySheet(params), "Estimate Summary");
  XLSX.utils.book_append_sheet(wb, buildBarListSheet(params), "Bar List");
  XLSX.utils.book_append_sheet(wb, buildReconciliationSheet(params), "Reconciliation");
  XLSX.utils.book_append_sheet(wb, buildAuditTraceSheet(params), "Audit Trace");
  XLSX.utils.book_append_sheet(wb, buildRawJsonSheet(params), "Raw JSON");

  const projectSlug = (scopeData?.projectName || "rebar-takeoff").replace(/\s+/g, "_");
  XLSX.writeFile(wb, `${projectSlug}_estimate_export.xlsx`);
}
