import React, { forwardRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText, Ruler, Share2 } from "lucide-react";
import ShopDrawingModal from "./ShopDrawingModal";
import ShareReviewDialog from "./ShareReviewDialog";
import { getMassKgPerM, kgToLbs } from "@/lib/rebar-weights";
import { exportExcelFile } from "@/lib/excel-export";

interface ExportButtonsProps {
  quoteResult: any;
  elements: any[];
  scopeData?: any;
  projectId?: string;
}

const ExportButtons = forwardRef<HTMLDivElement, ExportButtonsProps>(({ quoteResult, elements, scopeData, projectId }, ref) => {
  const [shopDrawingOpen, setShopDrawingOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const barList: any[] = quoteResult.quote.bar_list || [];
  const sizeBreakdown: Record<string, number> = quoteResult.quote.size_breakdown || {};
  const sizeBreakdownKg: Record<string, number> = quoteResult.quote.size_breakdown_kg || {};
  const totalLbs = quoteResult.quote.total_weight_lbs;
  const totalKg = quoteResult.quote.total_weight_kg || (totalLbs ? totalLbs * 0.453592 : 0);
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const handleExcelExport = () => {
    exportExcelFile({ quoteResult, elements, scopeData });
  };

  const handlePdfExport = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const grouped: Record<string, any[]> = {};
    for (const b of barList) { const t = b.element_type || "OTHER"; if (!grouped[t]) grouped[t] = []; grouped[t].push(b); }
    let barListHtml = ""; let grandTotal = 0;
    for (const [type, bars] of Object.entries(grouped)) {
      let subtotal = 0;
      barListHtml += `<tr class="group-header"><td colspan="8">${type}</td></tr>`;
      for (const b of bars) {
        const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : (b.weight_lbs || 0) * 0.453592;
        const unitWtKgM = getMassKgPerM(b.size);
        subtotal += wtKg;
        barListHtml += `<tr><td>${b.element_id}</td><td>${b.bar_mark || "—"}</td><td>${b.size}</td><td>${b.shape_code || "—"}</td><td>${b.qty}${b.multiplier > 1 ? ` ×${b.multiplier}` : ""}</td><td>${(b.length_mm || 0).toLocaleString()}</td><td>${unitWtKgM.toFixed(3)}</td><td>${wtKg.toFixed(1)}</td></tr>`;
      }
      barListHtml += `<tr class="subtotal"><td colspan="7" style="text-align:right">${type} Subtotal</td><td>${subtotal.toFixed(1)} kg</td></tr>`;
      grandTotal += subtotal;
    }
    barListHtml += `<tr class="grand-total"><td colspan="7" style="text-align:right">GRAND TOTAL</td><td>${grandTotal.toFixed(1)} kg</td></tr>`;

    const totalKgDisplay = Math.round(totalKg * 10) / 10;
    const totalTonnes = (totalKg / 1000).toFixed(2);

    const sizeTotal = Object.values(sizeBreakdown).reduce((a, b) => a + b, 0);
    const hasSizeKg = Object.keys(sizeBreakdownKg).length > 0;
    const sortedSizes = Object.entries(sizeBreakdown).sort((a, b) => parseInt(a[0].replace("#", "")) - parseInt(b[0].replace("#", "")));
    const sizeHtml = sortedSizes.map(([size, w]) => {
      const kgVal = hasSizeKg ? (sizeBreakdownKg[size] || w * 0.453592) : w * 0.453592;
      return `<tr><td>${size}</td><td>${kgVal.toFixed(1)}</td><td>${sizeTotal > 0 ? ((w / sizeTotal) * 100).toFixed(1) : "0.0"}%</td></tr>`;
    }).join("") + `<tr class="grand-total"><td>TOTAL</td><td>${totalKgDisplay.toLocaleString()} kg</td><td>100%</td></tr>`;

    const bentBars = barList.filter((b: any) => b.shape_code && b.shape_code !== "straight" && b.shape_code !== "closed");
    const bendHtml = bentBars.length > 0 ? `<div class="section page-break"><h2>Bending Schedule</h2><table><tr><th>Element</th><th>Bar Mark</th><th>Size</th><th>Shape</th><th>Qty</th><th>Length (mm)</th><th>Weight (kg)</th></tr>${bentBars.map((b: any) => { const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : (b.weight_lbs || 0) * 0.453592; return `<tr><td>${b.element_id}</td><td>${b.bar_mark || "—"}</td><td>${b.size}</td><td>${b.shape_code}</td><td>${b.qty}</td><td>${(b.length_mm || 0).toLocaleString()}</td><td>${wtKg.toFixed(1)}</td></tr>`; }).join("")}</table></div>` : "";

    const html = `<!DOCTYPE html><html><head><title>Rebar Estimation Report</title>
<style>@page{margin:0.75in;size:letter}*{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;margin:0;padding:40px;font-size:12px}.header{border-bottom:3px solid #1a1a2e;padding-bottom:12px;margin-bottom:24px}.header h1{margin:0;font-size:22px;color:#1a1a2e}.header .subtitle{font-size:13px;color:#555;margin-top:4px}.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:20px;font-size:12px}.meta-grid .label{font-weight:600;color:#333}.meta-grid .value{color:#555}.summary-boxes{display:flex;gap:24px;margin:20px 0}.summary-box{text-align:center;flex:1;padding:14px;border:1px solid #ddd;border-radius:8px}.summary-box .num{font-size:26px;font-weight:700;color:#1a1a2e}.summary-box .lbl{font-size:10px;color:#777;text-transform:uppercase;letter-spacing:0.5px}.section{margin-top:28px}.page-break{page-break-before:always}h2{font-size:15px;color:#1a1a2e;border-bottom:1px solid #ccc;padding-bottom:4px;margin-bottom:10px}table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px}th{background:#1a1a2e;color:#fff;padding:6px 8px;text-align:left;font-weight:600;font-size:10px;text-transform:uppercase}td{padding:5px 8px;border-bottom:1px solid #eee}tr:nth-child(even){background:#f9f9fb}.group-header td{background:#e8e8f0;font-weight:700;font-size:11px;padding:8px;border-bottom:2px solid #1a1a2e}.subtotal td{background:#f0f0f5;font-weight:600;border-top:1px solid #999}.grand-total td{background:#1a1a2e;color:#fff;font-weight:700;font-size:12px}.footer{margin-top:40px;padding-top:12px;border-top:1px solid #ccc;font-size:9px;color:#999;text-align:center}@media print{.page-break{page-break-before:always}body{padding:0}}</style></head><body>
<div class="header"><h1>Rebar Estimation Report</h1><div class="subtitle">${scopeData?.projectName || "Project"} — ${dateStr}</div></div>
<div class="meta-grid"><div><span class="label">Client:</span> <span class="value">${scopeData?.clientName || "—"}</span></div><div><span class="label">Project Type:</span> <span class="value">${scopeData?.projectType || "—"}</span></div><div><span class="label">Mode:</span> <span class="value">${quoteResult.mode === "ai_express" ? "AI Express" : "Verified"}</span></div><div><span class="label">Coating:</span> <span class="value">${scopeData?.coatingType || "Black Steel"}</span></div></div>
<div class="summary-boxes"><div class="summary-box"><div class="num">${totalKgDisplay.toLocaleString()}</div><div class="lbl">Total Weight (kg)</div></div><div class="summary-box"><div class="num">${totalTonnes}</div><div class="lbl">Tonnes</div></div><div class="summary-box"><div class="num">${quoteResult.included_count || quoteResult.quote.elements.length}</div><div class="lbl">Elements Included</div></div></div>
<div class="section"><h2>Bar List</h2><table><tr><th>Element</th><th>Bar Mark</th><th>Size</th><th>Shape</th><th>Qty</th><th>Length (mm)</th><th>Wt (kg/m)</th><th>Weight (kg)</th></tr>${barListHtml}</table></div>
<div class="section page-break"><h2>Size Summary</h2><table><tr><th>Rebar Size</th><th>Weight (kg)</th><th>Percentage</th></tr>${sizeHtml}</table></div>
${bendHtml}
<div class="footer">Generated by Rebar Estimator Pro &bull; ${dateStr}</div></body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  };

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
      <Button
        variant="outline"
        onClick={() => setShareOpen(true)}
        className="w-full gap-2 h-10 rounded-xl font-semibold border-accent/30 text-accent-foreground hover:bg-accent/10"
      >
        <Share2 className="h-4 w-4" />
        Share for Review
      </Button>
      <ShopDrawingModal open={shopDrawingOpen} onOpenChange={setShopDrawingOpen} quoteResult={quoteResult} elements={elements} scopeData={scopeData} projectId={projectId} />
      <ShareReviewDialog open={shareOpen} onOpenChange={setShareOpen} projectId={projectId} />
    </div>
  );
});

ExportButtons.displayName = "ExportButtons";

export default ExportButtons;
