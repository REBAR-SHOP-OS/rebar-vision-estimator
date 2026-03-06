/**
 * Excel export logic — produces the exact two-sheet format:
 *   Sheet 1: "Estimate Summary"
 *   Sheet 2: "Bar List"
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

// ── Sheet 1: Estimate Summary ───────────────────────────────────

function buildEstimateSummary(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult, scopeData } = params;
  const barList: any[] = quoteResult.quote.bar_list || [];
  const sizeBreakdownKg: Record<string, number> = quoteResult.quote.size_breakdown_kg || {};
  const sizeBreakdown: Record<string, number> = quoteResult.quote.size_breakdown || {};
  const totalKg = quoteResult.quote.total_weight_kg || (quoteResult.quote.total_weight_lbs ? quoteResult.quote.total_weight_lbs * 0.453592 : 0);

  // Build weight-by-size from sizeBreakdownKg or fallback
  const hasSizeKg = Object.keys(sizeBreakdownKg).length > 0;
  const sizeEntries: [string, number][] = [];
  const allSizes = new Set([...Object.keys(sizeBreakdownKg), ...Object.keys(sizeBreakdown)]);
  for (const size of allSizes) {
    const kg = hasSizeKg ? (sizeBreakdownKg[size] || (sizeBreakdown[size] || 0) * 0.453592) : (sizeBreakdown[size] || 0) * 0.453592;
    if (kg > 0) sizeEntries.push([size, kg]);
  }
  sizeEntries.sort((a, b) => {
    const na = parseInt(a[0].replace(/[^0-9]/g, ""));
    const nb = parseInt(b[0].replace(/[^0-9]/g, ""));
    return na - nb;
  });

  // Build weight-by-element from bar list
  const elemWeights: Record<string, number> = {};
  for (const b of barList) {
    const t = b.element_type || "OTHER";
    const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : (typeof b.weight_lbs === "number" ? b.weight_lbs * 0.453592 : 0);
    elemWeights[t] = (elemWeights[t] || 0) + wtKg;
  }
  const elemEntries = Object.entries(elemWeights).sort((a, b) => b[1] - a[1]);

  // Determine how many rows the tables need
  const maxRows = Math.max(sizeEntries.length, elemEntries.length);

  // Build AOA — 9 columns wide (A-I)
  const rows: any[][] = [];

  // Row 0: Project Name
  rows.push(["Project Name :", scopeData?.projectName || "—", "", "", "", "", "", "", ""]);
  // Row 1: Address
  rows.push(["Address :", scopeData?.address || "", "", "", "", "", "", "", ""]);
  // Row 2: Engineer
  rows.push(["Engineer :", scopeData?.engineer || "", "", "", "", "", "", "", ""]);
  // Row 3: Customer
  rows.push(["Customer :", scopeData?.clientName || "", "", "", "", "", "", "", ""]);
  // Row 4: Product Line
  rows.push(["Product Line :", scopeData?.coatingType || "Black Steel", "", "", "", "", "", "", ""]);
  // Row 5: blank
  rows.push([]);
  // Row 6: Estimate Summary header
  rows.push(["Estimate Summary", "", "", "", "", "", "", "", ""]);
  // Row 7: blank
  rows.push([]);
  // Row 8: Side-by-side table headers
  //   A-B: Weight Summary Report in Kgs
  //   F-H: Element wise Summary Report in Kgs
  rows.push(["Weight Summary Report in Kgs", "", "", "", "", "Element wise Summary Report in Kgs", "", "", ""]);
  // Row 9: Sub-headers
  rows.push(["Bar Size", "Weight (kg)", "", "", "", "S.No.", "Element", "Weight (kg)", ""]);

  // Data rows — side by side
  for (let i = 0; i < maxRows; i++) {
    const row: any[] = new Array(9).fill("");
    if (i < sizeEntries.length) {
      row[0] = sizeEntries[i][0];
      row[1] = Math.round(sizeEntries[i][1] * 10) / 10;
    }
    if (i < elemEntries.length) {
      row[5] = i + 1;
      row[6] = elemEntries[i][0];
      row[7] = Math.round(elemEntries[i][1] * 10) / 10;
    }
    rows.push(row);
  }

  // Totals row
  const totalSizeKg = sizeEntries.reduce((s, e) => s + e[1], 0);
  const totalElemKg = elemEntries.reduce((s, e) => s + e[1], 0);
  rows.push(["Grand Total (kg)", Math.round(totalSizeKg * 10) / 10, "", "", "", "", "Grand Total (kg)", Math.round(totalElemKg * 10) / 10, ""]);
  rows.push(["Grand Total (Tons)", (totalSizeKg / 1000).toFixed(2), "", "", "", "", "Grand Total (Tons)", (totalElemKg / 1000).toFixed(2), ""]);

  // Blank
  rows.push([]);

  // NOTES section
  rows.push(["NOTES"]);
  rows.push(["Grade :", scopeData?.rebarGrade || "400W"]);
  rows.push(["Lap Length Info :", scopeData?.lapLength || "As per Manual of Standard Practice"]);
  rows.push(["Deviations :", scopeData?.deviations || "None"]);
  rows.push(["Coating :", scopeData?.coatingType || "Black Steel"]);
  rows.push([]);

  // Scope items
  if (scopeData?.scopeItems?.length) {
    rows.push(["SCOPE ITEMS INCLUDED"]);
    for (const s of scopeData.scopeItems) {
      rows.push(["  •  " + s]);
    }
    rows.push([]);
  }

  // MESH DETAILS
  const meshDetails: any[] = quoteResult.quote.mesh_details || scopeData?.meshDetails || [];
  rows.push(["MESH DETAILS"]);
  rows.push(["Location", "Mesh Size", "Total Area (SQFT)"]);
  if (meshDetails.length > 0) {
    for (const m of meshDetails) {
      rows.push([m.location || "", m.mesh_size || "", m.area_sqft || ""]);
    }
  } else {
    rows.push(["N/A", "", ""]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 28 }, // A
    { wch: 16 }, // B
    { wch: 4 },  // C spacer
    { wch: 4 },  // D spacer
    { wch: 4 },  // E spacer
    { wch: 8 },  // F
    { wch: 28 }, // G
    { wch: 16 }, // H
    { wch: 4 },  // I
  ];

  // Merges
  ws["!merges"] = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: 4 } }, // project name merge
    { s: { r: 6, c: 0 }, e: { r: 6, c: 8 } }, // "Estimate Summary" header merge
    { s: { r: 8, c: 0 }, e: { r: 8, c: 1 } }, // Weight Summary header merge
    { s: { r: 8, c: 5 }, e: { r: 8, c: 7 } }, // Element Summary header merge
  ];

  return ws;
}

// ── Sheet 2: Bar List ───────────────────────────────────────────

function buildBarListSheet(params: ExportParams): XLSX.WorkSheet {
  const { quoteResult, elements, scopeData } = params;
  const barList: any[] = quoteResult.quote.bar_list || [];

  const rows: any[][] = [];

  // Row 0: Project header
  rows.push(["Project:", scopeData?.projectName || "—", "", "", "", "", "", "", "", "", "", "", ""]);
  // Row 1: blank
  rows.push([]);
  // Row 2: Column headers (13 columns)
  rows.push([
    "SL.No.",
    "Identification",
    "Multiplier",
    "Qty",
    "Bar Dia",
    "Length in feet inches",
    "Length in millimeters",
    "Bend",
    "Info 1",
    "Info 2 (@)",
    "Total Length (Mtr.)",
    "Total Wgt kg",
    "Notes",
  ]);

  // Group bars by element_type
  const grouped = groupBy(barList, (b: any) => b.element_type || "OTHER");
  let slNo = 1;
  let grandTotalKg = 0;
  let grandTotalLenM = 0;

  for (const [elemType, bars] of Object.entries(grouped)) {
    // Element type header row
    rows.push([elemType.toUpperCase(), "", "", "", "", "", "", "", "", "", "", "", ""]);

    // Sub-group by sub_element if available
    const subGrouped = groupBy(bars, (b: any) => b.sub_element || b.element_id || "");
    for (const [subElem, subBars] of Object.entries(subGrouped)) {
      if (subElem && subElem !== elemType) {
        rows.push(["", subElem, "", "", "", "", "", "", "", "", "", "", ""]);
      }

      for (const b of subBars) {
        const mult = b.multiplier || 1;
        const qty = b.qty || 0;
        const lengthMm = b.length_mm || (b.length_ft ? b.length_ft * 304.8 : 0);
        const lengthFtIn = mmToFtIn(lengthMm);
        const totalPieces = qty * mult;
        const totalLenM = (totalPieces * lengthMm) / 1000;
        const massKgM = getMassKgPerM(b.size);
        const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : totalLenM * massKgM;

        const isBent = b.shape_code && b.shape_code !== "straight" && b.shape_code !== "STRAIGHT";
        const bendType = isBent ? "BEND BARS" : "STRAIGHT BARS";

        // Build identification string
        const spacing = b.spacing ? ` @ ${b.spacing}` : "";
        const desc = b.description || b.bar_mark || "";
        const identification = `${b.size || ""}${spacing}${desc ? " " + desc : ""}`.trim();

        rows.push([
          slNo,
          identification,
          mult,
          qty,
          b.size || "",
          lengthFtIn,
          Math.round(lengthMm),
          bendType,
          b.info1 || b.shape_code || "",
          b.info2 || "",
          Math.round(totalLenM * 1000) / 1000,
          Math.round(wtKg * 10) / 10,
          b.notes || "",
        ]);
        slNo++;
        grandTotalKg += wtKg;
        grandTotalLenM += totalLenM;
      }
    }

    // Blank separator between element groups
    rows.push([]);
  }

  // TOTAL WEIGHT row
  rows.push(["", "", "", "", "", "", "", "", "", "TOTAL WEIGHT", Math.round(grandTotalLenM * 1000) / 1000, Math.round(grandTotalKg * 10) / 10, ""]);
  rows.push(["", "", "", "", "", "", "", "", "", "TOTAL (Tons)", "", (grandTotalKg / 1000).toFixed(2), ""]);
  rows.push([]);

  // MESH DETAILS
  const meshDetails: any[] = quoteResult.quote.mesh_details || scopeData?.meshDetails || [];
  rows.push(["MESH DETAILS"]);
  rows.push(["Location", "Mesh Size", "Total Area (SQFT)"]);
  if (meshDetails.length > 0) {
    for (const m of meshDetails) {
      rows.push([m.location || "", m.mesh_size || "", m.area_sqft || ""]);
    }
  } else {
    rows.push(["N/A", "", ""]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws["!cols"] = [
    { wch: 8 },   // SL.No.
    { wch: 30 },  // Identification
    { wch: 10 },  // Multiplier
    { wch: 6 },   // Qty
    { wch: 8 },   // Bar Dia
    { wch: 18 },  // Length ft-in
    { wch: 18 },  // Length mm
    { wch: 14 },  // Bend
    { wch: 12 },  // Info 1
    { wch: 12 },  // Info 2
    { wch: 16 },  // Total Length (Mtr.)
    { wch: 14 },  // Total Wgt kg
    { wch: 16 },  // Notes
  ];

  // Merge project header
  ws["!merges"] = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: 6 } },
  ];

  return ws;
}

// ── Main export function ────────────────────────────────────────

export function exportExcelFile(params: ExportParams) {
  const { scopeData } = params;
  const wb = XLSX.utils.book_new();

  const summaryWs = buildEstimateSummary(params);
  XLSX.utils.book_append_sheet(wb, summaryWs, "Estimate Summary");

  const barListWs = buildBarListSheet(params);
  XLSX.utils.book_append_sheet(wb, barListWs, "Bar List");

  const projectSlug = (scopeData?.projectName || "rebar-takeoff").replace(/\s+/g, "_");
  XLSX.writeFile(wb, `${projectSlug}_Estimation_File.xlsx`);
}
