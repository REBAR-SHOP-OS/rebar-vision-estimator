/**
 * Excel export logic — produces a multi-sheet workbook:
 *   Sheet 1: "Summary"
 *   Sheet 2: "Rebar Items"
 *   Sheet 3: "Wire Mesh"
 *   Sheet 4: "Reconciliation"
 *   Sheet 5: "Audit Trace"
 *   Sheet 6: "Raw JSON"
 *
 * Legacy sheets ("Estimate Summary", "Bar List") preserved as alternate export.
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

// ── Sheet 1: Summary ───────────────────────────────────────────

function buildSummarySheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult, scopeData } = params;
  const recon = quoteResult.quote.reconciliation || {};
  const isBlocked = quoteResult.quote.job_status === "VALIDATION_FAILED" || quoteResult.quote.job_status === "BLOCKED";
  const isFlagged = recon.risk_level === "FLAG" || quoteResult.quote.job_status === "FLAGGED";

  const barList: any[] = quoteResult.quote.bar_list || [];
  const sizeBreakdownKg: Record<string, number> = quoteResult.quote.size_breakdown_kg || {};
  const sizeBreakdown: Record<string, number> = quoteResult.quote.size_breakdown || {};
  const totalKg = quoteResult.quote.total_weight_kg || (quoteResult.quote.total_weight_lbs ? quoteResult.quote.total_weight_lbs * 0.453592 : 0);

  const rows: any[][] = [];

  // Warning banner
  if (isBlocked) {
    rows.push(["⚠ WARNING: Estimate status is BLOCKED — results may be incomplete or invalid"]);
    rows.push([]);
  } else if (isFlagged) {
    rows.push(["⚠ NOTICE: Estimate flagged for review — verify before final use"]);
    rows.push([]);
  }

  // Header fields
  rows.push(["Project Name", scopeData?.projectName || "—"]);
  rows.push(["Client Name", scopeData?.clientName || "—"]);
  rows.push(["Estimate Date", new Date().toISOString()]);
  rows.push(["Estimator Version", "v2026-03-10 (Rev B — HARDENED)"]);
  rows.push([]);

  // Weight totals
  const drawingTotal = recon.drawing_based_total || totalKg;
  const normTotal = recon.industry_norm_total || 0;
  const variancePct = recon.variance_pct ?? (normTotal > 0 ? Math.abs(drawingTotal - normTotal) / normTotal * 100 : 0);
  const riskLevel = recon.risk_level || (variancePct < 15 ? "OK" : variancePct < 35 ? "FLAG" : "RISK_ALERT");

  rows.push(["Drawing-Based Total Weight (kg)", Math.round(drawingTotal * 10) / 10]);
  rows.push(["Industry Norm Total Weight (kg)", normTotal > 0 ? Math.round(normTotal * 10) / 10 : "N/A"]);
  rows.push(["Variance (%)", normTotal > 0 ? Math.round(variancePct * 10) / 10 : "N/A"]);
  rows.push(["Risk Level", riskLevel]);
  rows.push([]);

  // Weight-by-size breakdown
  const hasSizeKg = Object.keys(sizeBreakdownKg).length > 0;
  const allSizes = new Set([...Object.keys(sizeBreakdownKg), ...Object.keys(sizeBreakdown)]);
  const sizeEntries: [string, number][] = [];
  for (const size of allSizes) {
    const kg = hasSizeKg ? (sizeBreakdownKg[size] || (sizeBreakdown[size] || 0) * 0.453592) : (sizeBreakdown[size] || 0) * 0.453592;
    if (kg > 0) sizeEntries.push([size, kg]);
  }
  sizeEntries.sort((a, b) => parseInt(a[0].replace(/[^0-9]/g, "")) - parseInt(b[0].replace(/[^0-9]/g, "")));

  rows.push(["Weight by Size"]);
  rows.push(["Bar Size", "Weight (kg)"]);
  for (const [size, kg] of sizeEntries) {
    rows.push([size, Math.round(kg * 10) / 10]);
  }
  rows.push([]);

  // Weight-by-element breakdown
  const elemWeights: Record<string, number> = {};
  for (const b of barList) {
    const t = b.element_type || "OTHER";
    const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : (typeof b.weight_lbs === "number" ? b.weight_lbs * 0.453592 : 0);
    elemWeights[t] = (elemWeights[t] || 0) + wtKg;
  }
  const elemEntries = Object.entries(elemWeights).sort((a, b) => b[1] - a[1]);

  rows.push(["Weight by Element"]);
  rows.push(["Element", "Weight (kg)"]);
  for (const [elem, kg] of elemEntries) {
    rows.push([elem, Math.round(kg * 10) / 10]);
  }

  // Risk flags
  const riskFlags: string[] = quoteResult.quote.risk_flags || [];
  if (riskFlags.length > 0) {
    rows.push([]);
    rows.push(["Risk Flags"]);
    for (const f of riskFlags) rows.push(["⚠ " + f]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 36 }, { wch: 24 }];
  return ws;
}

// ── Sheet 2: Rebar Items ────────────────────────────────────────

function buildRebarItemsSheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult } = params;
  const barList: any[] = quoteResult.quote.bar_list || [];

  const rows: any[][] = [];
  rows.push(["Element", "Mark", "Bar Size", "Spacing", "Quantity", "Length (mm)", "Unit Weight (kg/m)", "Total Weight (kg)", "Source Basis", "Confidence", "Page Ref", "Region Ref", "Status"]);

  for (const b of barList) {
    const lengthMm = b.length_mm || (b.length_ft ? b.length_ft * 304.8 : 0);
    const massKgM = getMassKgPerM(b.size);
    const totalPieces = (b.qty || 0) * (b.multiplier || 1);
    const totalLenM = (totalPieces * lengthMm) / 1000;
    const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : totalLenM * massKgM;

    rows.push([
      b.element_type || "OTHER",
      b.bar_mark || b.description || "",
      b.size || "",
      b.spacing || "",
      b.qty || 0,
      Math.round(lengthMm),
      Math.round(massKgM * 1000) / 1000,
      Math.round(wtKg * 10) / 10,
      b.source_basis || b.truth_source || "",
      b.confidence ?? "",
      b.page_ref ?? b.page ?? "",
      b.region_ref ?? "",
      b.status || "READY",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 },
  ];
  return ws;
}

// ── Sheet 3: Wire Mesh ──────────────────────────────────────────

function buildWireMeshSheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult, scopeData } = params;
  const meshDetails: any[] = quoteResult.quote.mesh_details || scopeData?.meshDetails || [];

  const rows: any[][] = [];
  rows.push(["Area / Location", "Sheet Type", "Overlap", "Sheet Count", "Total Area (SQFT)", "Source Basis", "Confidence", "Status"]);

  if (meshDetails.length > 0) {
    for (const m of meshDetails) {
      rows.push([
        m.location || m.area || "",
        m.mesh_size || m.sheet_type || "",
        m.overlap || "",
        m.sheet_count || "",
        m.area_sqft || m.total_area || "",
        m.source_basis || "",
        m.confidence ?? "",
        m.status || "READY",
      ]);
    }
  } else {
    rows.push(["N/A", "", "", "", "", "", "", ""]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 16 },
    { wch: 14 }, { wch: 10 }, { wch: 10 },
  ];
  return ws;
}

// ── Sheet 4: Reconciliation ─────────────────────────────────────

function buildReconciliationSheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult } = params;
  const recon = quoteResult.quote.reconciliation || {};
  const barList: any[] = quoteResult.quote.bar_list || [];

  const rows: any[][] = [];
  rows.push(["Element", "Drawing Weight (kg)", "Norm Weight (kg)", "Variance (%)", "Reconciliation Status", "Notes"]);

  // Per-element reconciliation if available
  const elemRecon: any[] = recon.element_reconciliation || [];
  if (elemRecon.length > 0) {
    for (const er of elemRecon) {
      rows.push([
        er.element || "",
        er.drawing_weight != null ? Math.round(er.drawing_weight * 10) / 10 : "",
        er.norm_weight != null ? Math.round(er.norm_weight * 10) / 10 : "",
        er.variance_percent != null ? Math.round(er.variance_percent * 10) / 10 : "",
        er.status || "",
        er.notes || "",
      ]);
    }
  } else {
    // Aggregate-only fallback
    const elemWeights: Record<string, number> = {};
    for (const b of barList) {
      const t = b.element_type || "OTHER";
      const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : 0;
      elemWeights[t] = (elemWeights[t] || 0) + wtKg;
    }
    for (const [elem, wt] of Object.entries(elemWeights)) {
      rows.push([elem, Math.round(wt * 10) / 10, "", "", "", ""]);
    }
  }

  // Summary row
  rows.push([]);
  rows.push(["TOTAL", recon.drawing_based_total ? Math.round(recon.drawing_based_total * 10) / 10 : "", recon.industry_norm_total ? Math.round(recon.industry_norm_total * 10) / 10 : "", recon.variance_pct != null ? Math.round(recon.variance_pct * 10) / 10 : "", recon.risk_level || "", ""]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 24 },
  ];
  return ws;
}

// ── Sheet 5: Audit Trace ────────────────────────────────────────

function buildAuditTraceSheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult } = params;
  const auditTrace = quoteResult.quote.audit_trace || {};

  const rows: any[][] = [];
  rows.push(["Stage", "Stage Status", "Input Hash", "Output Hash", "Timestamp"]);

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
  ws["!cols"] = [
    { wch: 16 }, { wch: 16 }, { wch: 40 }, { wch: 40 }, { wch: 24 },
  ];
  return ws;
}

// ── Sheet 6: Raw JSON ───────────────────────────────────────────

function buildRawJsonSheet(params: ExportParams): XLSX.WorkSheet {
  const jsonStr = JSON.stringify(params.quoteResult, null, 2);
  const lines = jsonStr.split("\n");
  const rows: any[][] = [["Raw JSON Output"]];
  for (const line of lines) {
    rows.push([line]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 120 }];
  return ws;
}

// ── Main export function ────────────────────────────────────────

export function exportExcelFile(params: ExportParams) {
  const { scopeData } = params;
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildSummarySheet(params), "Summary");
  XLSX.utils.book_append_sheet(wb, buildRebarItemsSheet(params), "Rebar Items");
  XLSX.utils.book_append_sheet(wb, buildWireMeshSheet(params), "Wire Mesh");
  XLSX.utils.book_append_sheet(wb, buildReconciliationSheet(params), "Reconciliation");
  XLSX.utils.book_append_sheet(wb, buildAuditTraceSheet(params), "Audit Trace");
  XLSX.utils.book_append_sheet(wb, buildRawJsonSheet(params), "Raw JSON");

  const projectSlug = (scopeData?.projectName || "rebar-takeoff").replace(/\s+/g, "_");
  XLSX.writeFile(wb, `${projectSlug}_estimate_export.xlsx`);
}
