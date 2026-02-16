import React, { forwardRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText, Ruler } from "lucide-react";
import * as XLSX from "xlsx";
import ShopDrawingModal from "./ShopDrawingModal";

// Rebar unit weights in lb/ft
const REBAR_UNIT_WEIGHT: Record<string, number> = {
  "#3": 0.376, "#4": 0.668, "#5": 1.043, "#6": 1.502, "#7": 2.044,
  "#8": 2.670, "#9": 3.400, "#10": 4.303, "#11": 5.313, "#14": 7.650, "#18": 13.60,
  "10M": 0.527, "15M": 1.055, "20M": 1.582, "25M": 2.637,
  "30M": 3.692, "35M": 5.274, "45M": 7.914, "55M": 13.186,
};

interface ExportButtonsProps {
  quoteResult: any;
  elements: any[];
  scopeData?: any;
  projectId?: string;
}

const ExportButtons = forwardRef<HTMLDivElement, ExportButtonsProps>(({ quoteResult, elements, scopeData, projectId }, ref) => {
  const [shopDrawingOpen, setShopDrawingOpen] = useState(false);
  const barList: any[] = quoteResult.quote.bar_list || [];
  const sizeBreakdown: Record<string, number> = quoteResult.quote.size_breakdown || {};
  const totalLbs = quoteResult.quote.total_weight_lbs;
  const totalTons = quoteResult.quote.total_weight_tons;
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // ─── Excel Export ───────────────────────────────────────────────
  const handleExcelExport = () => {
    const wb = XLSX.utils.book_new();

    const coverData: any[][] = [
      ["REBAR ESTIMATOR PRO"], ["Rebar Estimation Report"], [],
      ["Project Name", scopeData?.projectName || "—"],
      ["Client Name", scopeData?.clientName || "—"],
      ["Project Type", scopeData?.projectType || "—"],
      ["Date Generated", dateStr],
      ["Rebar Coating", scopeData?.coatingType || "Black Steel"],
      [], ["SCOPE ITEMS INCLUDED"],
      ...(scopeData?.scopeItems || []).map((s: string) => ["  •  " + s]),
      [], ["DEVIATIONS / NOTES"], [scopeData?.deviations || "None"],
      [], ["GRAND TOTAL"],
      ["Total Weight (lbs)", totalLbs], ["Total Weight (tons)", totalTons],
      [], ["ELEMENT COUNT"],
      ["Ready", quoteResult.included_count || quoteResult.quote.elements.length],
      ["Flagged", elements.filter((e: any) => e.status === "FLAGGED").length],
      ["Excluded", quoteResult.excluded_count || 0],
    ];
    const coverWs = XLSX.utils.aoa_to_sheet(coverData);
    coverWs["!cols"] = [{ wch: 30 }, { wch: 30 }];
    coverWs["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }];
    XLSX.utils.book_append_sheet(wb, coverWs, "Cover Page");

    const barHeaders = ["Element ID", "Bar Mark", "Size", "Shape Code", "Qty", "Length (ft)", "Unit Wt (lb/ft)", "Total Weight (lbs)"];
    const barRows: any[][] = [barHeaders];
    const grouped: Record<string, any[]> = {};
    for (const b of barList) { const t = b.element_type || "OTHER"; if (!grouped[t]) grouped[t] = []; grouped[t].push(b); }
    let grandTotal = 0;
    for (const [type, bars] of Object.entries(grouped)) {
      barRows.push([`── ${type} ──`, "", "", "", "", "", "", ""]);
      let subtotal = 0;
      for (const b of bars) { const unitWt = REBAR_UNIT_WEIGHT[b.size] || 0; const wt = typeof b.weight_lbs === "number" ? b.weight_lbs : 0; subtotal += wt; barRows.push([b.element_id, b.bar_mark, b.size, b.shape_code, b.qty, b.length_ft, unitWt, wt]); }
      barRows.push(["", "", "", "", "", "", `${type} Subtotal`, subtotal]); barRows.push([]); grandTotal += subtotal;
    }
    barRows.push(["", "", "", "", "", "", "GRAND TOTAL", grandTotal]);
    const barWs = XLSX.utils.aoa_to_sheet(barRows);
    barWs["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, barWs, "Bar List");

    const sizeTotal = Object.values(sizeBreakdown).reduce((a, b) => a + b, 0);
    const sortedSizes = Object.entries(sizeBreakdown).sort((a, b) => parseInt(a[0].replace("#", "")) - parseInt(b[0].replace("#", "")));
    const sizeRows: any[][] = [["Rebar Size", "Total Weight (lbs)", "Percentage (%)"]];
    for (const [size, weight] of sortedSizes) { sizeRows.push([size, weight, (sizeTotal > 0 ? ((weight / sizeTotal) * 100).toFixed(1) : "0.0") + "%"]); }
    sizeRows.push(["TOTAL", sizeTotal, "100%"]);
    const sizeWs = XLSX.utils.aoa_to_sheet(sizeRows);
    sizeWs["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, sizeWs, "Size Summary");

    const bentBars = barList.filter((b: any) => b.shape_code && b.shape_code !== "straight" && b.shape_code !== "closed");
    if (bentBars.length > 0) {
      const bendRows: any[][] = [["Element ID", "Bar Mark", "Size", "Shape Code", "Qty", "Length (ft)", "Weight (lbs)"]];
      const byShape: Record<string, any[]> = {};
      for (const b of bentBars) { const sc = b.shape_code || "unknown"; if (!byShape[sc]) byShape[sc] = []; byShape[sc].push(b); }
      for (const [shape, bars] of Object.entries(byShape)) { bendRows.push([`── ${shape} ──`, "", "", "", "", "", ""]); for (const b of bars) { bendRows.push([b.element_id, b.bar_mark, b.size, b.shape_code, b.qty, b.length_ft, b.weight_lbs]); } bendRows.push([]); }
      const bendWs = XLSX.utils.aoa_to_sheet(bendRows);
      bendWs["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 6 }, { wch: 12 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, bendWs, "Bending Schedule");
    }

    const elemRows: any[][] = [["Element ID", "Type", "Status", "Confidence (%)", "Total Weight (lbs)"]];
    for (const el of elements) { const conf = el.extraction?.confidence !== undefined ? (el.extraction.confidence * 100).toFixed(0) : "—"; const wInfo = quoteResult.quote.elements.find((q: any) => q.element_id === el.element_id); elemRows.push([el.element_id, el.element_type, el.status, conf, wInfo ? wInfo.weight_lbs : "—"]); }
    const elemWs = XLSX.utils.aoa_to_sheet(elemRows);
    elemWs["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, elemWs, "Elements Detail");

    const notesData: any[][] = [["PROJECT NOTES"], [], ["Deviations", scopeData?.deviations || "None"], [], ["Scope Items"], ...(scopeData?.scopeItems || []).map((s: string) => ["  •  " + s]), [], ["Calculation Mode", quoteResult.mode === "ai_express" ? "AI Express" : "Verified"], [], ["DISCLAIMER"], ["This estimation is generated by Rebar Estimator Pro and should be verified by a qualified engineer before use in construction."], ["Generated on " + dateStr]];
    const notesWs = XLSX.utils.aoa_to_sheet(notesData);
    notesWs["!cols"] = [{ wch: 20 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, notesWs, "Notes");

    const projectSlug = (scopeData?.projectName || "rebar-takeoff").replace(/\s+/g, "_");
    XLSX.writeFile(wb, `${projectSlug}_Estimation_File.xlsx`);
  };

  // ─── PDF Export ─────────────────────────────────────────────────
  const handlePdfExport = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const grouped: Record<string, any[]> = {};
    for (const b of barList) { const t = b.element_type || "OTHER"; if (!grouped[t]) grouped[t] = []; grouped[t].push(b); }
    let barListHtml = ""; let grandTotal = 0;
    for (const [type, bars] of Object.entries(grouped)) {
      let subtotal = 0;
      barListHtml += `<tr class="group-header"><td colspan="8">${type}</td></tr>`;
      for (const b of bars) { const unitWt = REBAR_UNIT_WEIGHT[b.size] || 0; const wt = typeof b.weight_lbs === "number" ? b.weight_lbs : 0; subtotal += wt; barListHtml += `<tr><td>${b.element_id}</td><td>${b.bar_mark || "—"}</td><td>${b.size}</td><td>${b.shape_code || "—"}</td><td>${b.qty}</td><td>${b.length_ft}</td><td>${unitWt.toFixed(3)}</td><td>${wt.toLocaleString()}</td></tr>`; }
      barListHtml += `<tr class="subtotal"><td colspan="7" style="text-align:right">${type} Subtotal</td><td>${subtotal.toLocaleString()}</td></tr>`;
      grandTotal += subtotal;
    }
    barListHtml += `<tr class="grand-total"><td colspan="7" style="text-align:right">GRAND TOTAL</td><td>${grandTotal.toLocaleString()}</td></tr>`;

    const sizeTotal = Object.values(sizeBreakdown).reduce((a, b) => a + b, 0);
    const sortedSizes = Object.entries(sizeBreakdown).sort((a, b) => parseInt(a[0].replace("#", "")) - parseInt(b[0].replace("#", "")));
    const sizeHtml = sortedSizes.map(([size, w]) => `<tr><td>${size}</td><td>${w.toLocaleString()}</td><td>${sizeTotal > 0 ? ((w / sizeTotal) * 100).toFixed(1) : "0.0"}%</td></tr>`).join("") + `<tr class="grand-total"><td>TOTAL</td><td>${sizeTotal.toLocaleString()}</td><td>100%</td></tr>`;

    const bentBars = barList.filter((b: any) => b.shape_code && b.shape_code !== "straight" && b.shape_code !== "closed");
    const bendHtml = bentBars.length > 0 ? `<div class="section page-break"><h2>Bending Schedule</h2><table><tr><th>Element</th><th>Bar Mark</th><th>Size</th><th>Shape</th><th>Qty</th><th>Length (ft)</th><th>Weight (lbs)</th></tr>${bentBars.map((b: any) => `<tr><td>${b.element_id}</td><td>${b.bar_mark || "—"}</td><td>${b.size}</td><td>${b.shape_code}</td><td>${b.qty}</td><td>${b.length_ft}</td><td>${b.weight_lbs}</td></tr>`).join("")}</table></div>` : "";

    const html = `<!DOCTYPE html><html><head><title>Rebar Estimation Report</title>
<style>@page{margin:0.75in;size:letter}*{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;margin:0;padding:40px;font-size:12px}.header{border-bottom:3px solid #1a1a2e;padding-bottom:12px;margin-bottom:24px}.header h1{margin:0;font-size:22px;color:#1a1a2e}.header .subtitle{font-size:13px;color:#555;margin-top:4px}.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:20px;font-size:12px}.meta-grid .label{font-weight:600;color:#333}.meta-grid .value{color:#555}.summary-boxes{display:flex;gap:24px;margin:20px 0}.summary-box{text-align:center;flex:1;padding:14px;border:1px solid #ddd;border-radius:8px}.summary-box .num{font-size:26px;font-weight:700;color:#1a1a2e}.summary-box .lbl{font-size:10px;color:#777;text-transform:uppercase;letter-spacing:0.5px}.section{margin-top:28px}.page-break{page-break-before:always}h2{font-size:15px;color:#1a1a2e;border-bottom:1px solid #ccc;padding-bottom:4px;margin-bottom:10px}table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px}th{background:#1a1a2e;color:#fff;padding:6px 8px;text-align:left;font-weight:600;font-size:10px;text-transform:uppercase}td{padding:5px 8px;border-bottom:1px solid #eee}tr:nth-child(even){background:#f9f9fb}.group-header td{background:#e8e8f0;font-weight:700;font-size:11px;padding:8px;border-bottom:2px solid #1a1a2e}.subtotal td{background:#f0f0f5;font-weight:600;border-top:1px solid #999}.grand-total td{background:#1a1a2e;color:#fff;font-weight:700;font-size:12px}.footer{margin-top:40px;padding-top:12px;border-top:1px solid #ccc;font-size:9px;color:#999;text-align:center}@media print{.page-break{page-break-before:always}body{padding:0}}</style></head><body>
<div class="header"><h1>Rebar Estimation Report</h1><div class="subtitle">${scopeData?.projectName || "Project"} — ${dateStr}</div></div>
<div class="meta-grid"><div><span class="label">Client:</span> <span class="value">${scopeData?.clientName || "—"}</span></div><div><span class="label">Project Type:</span> <span class="value">${scopeData?.projectType || "—"}</span></div><div><span class="label">Mode:</span> <span class="value">${quoteResult.mode === "ai_express" ? "AI Express" : "Verified"}</span></div><div><span class="label">Coating:</span> <span class="value">${scopeData?.coatingType || "Black Steel"}</span></div></div>
<div class="summary-boxes"><div class="summary-box"><div class="num">${totalLbs.toLocaleString()}</div><div class="lbl">Total Weight (lbs)</div></div><div class="summary-box"><div class="num">${totalTons}</div><div class="lbl">Total Weight (tons)</div></div><div class="summary-box"><div class="num">${quoteResult.included_count || quoteResult.quote.elements.length}</div><div class="lbl">Elements Included</div></div></div>
<div class="section"><h2>Bar List</h2><table><tr><th>Element</th><th>Bar Mark</th><th>Size</th><th>Shape</th><th>Qty</th><th>Length (ft)</th><th>Unit Wt</th><th>Weight (lbs)</th></tr>${barListHtml}</table></div>
<div class="section page-break"><h2>Size Summary</h2><table><tr><th>Rebar Size</th><th>Weight (lbs)</th><th>Percentage</th></tr>${sizeHtml}</table></div>
${bendHtml}
<div class="footer">Generated by Rebar Estimator Pro &bull; ${dateStr}</div></body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  };

  // ─── Shop Drawing Export ────────────────────────────────────────
  return (
    <div ref={ref} className="flex flex-col gap-2 mt-4 pt-3 border-t border-border">
      <div className="flex gap-2">
        <Button onClick={handleExcelExport} className="flex-1 gap-2 h-10 rounded-xl font-semibold bg-primary hover:bg-primary/90">
          <FileSpreadsheet className="h-4 w-4" />
          Export Excel
        </Button>
        <Button variant="outline" onClick={handlePdfExport} className="flex-1 gap-2 h-10 rounded-xl font-semibold">
          <FileText className="h-4 w-4" />
          Download PDF
        </Button>
      </div>
      <Button
        variant="outline"
        onClick={() => setShopDrawingOpen(true)}
        className="w-full gap-2 h-10 rounded-xl font-semibold border-primary/30 text-primary hover:bg-primary/10"
      >
        <Ruler className="h-4 w-4" />
        Create Shop Drawing
      </Button>
      <ShopDrawingModal
        open={shopDrawingOpen}
        onOpenChange={setShopDrawingOpen}
        quoteResult={quoteResult}
        elements={elements}
        scopeData={scopeData}
        projectId={projectId}
      />
    </div>
  );
});

ExportButtons.displayName = "ExportButtons";

export default ExportButtons;
