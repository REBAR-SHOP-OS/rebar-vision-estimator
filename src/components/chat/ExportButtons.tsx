import React, { forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";

interface ExportButtonsProps {
  quoteResult: any;
  elements: any[];
}

const ExportButtons = forwardRef<HTMLDivElement, ExportButtonsProps>(({ quoteResult, elements }, ref) => {
  const handleExcelExport = () => {
    const wb = XLSX.utils.book_new();

    // Summary sheet
    const summaryData = [
      ["Rebar Takeoff Summary"],
      [],
      ["Mode", quoteResult.mode === "ai_express" ? "AI Express" : "Verified"],
      ["Total Weight (lbs)", quoteResult.quote.total_weight_lbs],
      ["Total Weight (tons)", quoteResult.quote.total_weight_tons],
      ["Elements Included", quoteResult.included_count || quoteResult.quote.elements.length],
      ["Elements Excluded", quoteResult.excluded_count || 0],
    ];
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

    // Elements Detail sheet
    const elemHeaders = ["Element ID", "Element Type", "Weight (lbs)"];
    const elemRows = quoteResult.quote.elements.map((el: any) => [
      el.element_id,
      el.element_type,
      el.weight_lbs,
    ]);
    const elemWs = XLSX.utils.aoa_to_sheet([elemHeaders, ...elemRows]);
    XLSX.utils.book_append_sheet(wb, elemWs, "Elements Detail");

    // Size Breakdown sheet
    const sizeHeaders = ["Rebar Size", "Total Weight (lbs)"];
    const sizeRows = Object.entries(quoteResult.quote.size_breakdown || {}).map(([size, weight]) => [
      size,
      weight,
    ]);
    const sizeWs = XLSX.utils.aoa_to_sheet([sizeHeaders, ...sizeRows]);
    XLSX.utils.book_append_sheet(wb, sizeWs, "Size Breakdown");

    // Bar List sheet
    const barList = quoteResult.quote.bar_list || [];
    if (barList.length > 0) {
      const barHeaders = ["Element ID", "Element Type", "Bar Mark", "Size", "Shape Code", "Qty", "Length (ft)", "Weight (lbs)"];
      const barRows = barList.map((b: any) => [
        b.element_id,
        b.element_type,
        b.bar_mark,
        b.size,
        b.shape_code,
        b.qty,
        b.length_ft,
        b.weight_lbs,
      ]);
      const barWs = XLSX.utils.aoa_to_sheet([barHeaders, ...barRows]);
      XLSX.utils.book_append_sheet(wb, barWs, "Bar List");
    }

    // Bending Schedule sheet
    const bentBars = barList.filter((b: any) => b.shape_code && b.shape_code !== "straight" && b.shape_code !== "closed");
    if (bentBars.length > 0) {
      const bendHeaders = ["Element ID", "Bar Mark", "Size", "Shape Code", "Qty", "Length (ft)", "Weight (lbs)"];
      const bendRows = bentBars.map((b: any) => [
        b.element_id,
        b.bar_mark,
        b.size,
        b.shape_code,
        b.qty,
        b.length_ft,
        b.weight_lbs,
      ]);
      const bendWs = XLSX.utils.aoa_to_sheet([bendHeaders, ...bendRows]);
      XLSX.utils.book_append_sheet(wb, bendWs, "Bending Schedule");
    }

    XLSX.writeFile(wb, "rebar-takeoff.xlsx");
  };

  const handlePdfExport = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const barList = quoteResult.quote.bar_list || [];
    const barListHtml = barList.length > 0 ? `
      <h2>Bar List</h2>
      <table>
        <tr><th>Element</th><th>Bar Mark</th><th>Size</th><th>Shape</th><th>Qty</th><th>Length (ft)</th><th>Weight (lbs)</th></tr>
        ${barList.map((b: any) => `<tr><td>${b.element_id}</td><td>${b.bar_mark}</td><td>${b.size}</td><td>${b.shape_code}</td><td>${b.qty}</td><td>${b.length_ft}</td><td>${b.weight_lbs}</td></tr>`).join("")}
      </table>
    ` : "";

    const html = `
      <!DOCTYPE html>
      <html><head><title>Rebar Takeoff Report</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
        h1 { color: #1a1a2e; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
        h2 { color: #16213e; margin-top: 24px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }
        th { background: #f0f0f0; font-weight: 600; }
        .summary { display: flex; gap: 40px; margin: 16px 0; }
        .summary-item { text-align: center; }
        .summary-item .value { font-size: 28px; font-weight: 700; color: #1a1a2e; }
        .summary-item .label { font-size: 12px; color: #666; }
        @media print { body { padding: 20px; } }
      </style></head><body>
        <h1>Rebar Takeoff Report</h1>
        <p>Mode: ${quoteResult.mode === "ai_express" ? "AI Express" : "Verified"}</p>
        <div class="summary">
          <div class="summary-item">
            <div class="value">${quoteResult.quote.total_weight_lbs.toLocaleString()}</div>
            <div class="label">Total Weight (lbs)</div>
          </div>
          <div class="summary-item">
            <div class="value">${quoteResult.quote.total_weight_tons}</div>
            <div class="label">Total Weight (tons)</div>
          </div>
        </div>
        <h2>Elements</h2>
        <table>
          <tr><th>Element ID</th><th>Type</th><th>Weight (lbs)</th></tr>
          ${quoteResult.quote.elements.map((el: any) => `<tr><td>${el.element_id}</td><td>${el.element_type}</td><td>${el.weight_lbs}</td></tr>`).join("")}
        </table>
        <h2>Size Breakdown</h2>
        <table>
          <tr><th>Rebar Size</th><th>Weight (lbs)</th></tr>
          ${Object.entries(quoteResult.quote.size_breakdown || {}).map(([size, w]) => `<tr><td>${size}</td><td>${w}</td></tr>`).join("")}
        </table>
        ${barListHtml}
        <p style="margin-top:24px;font-size:11px;color:#999;">Generated by Rebar Estimator Pro</p>
      </body></html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  };

  return (
    <div ref={ref} className="flex gap-2 mt-3">
      <Button variant="outline" size="sm" onClick={handleExcelExport} className="gap-2 text-xs">
        <FileSpreadsheet className="h-3.5 w-3.5" />
        Export Excel
      </Button>
      <Button variant="outline" size="sm" onClick={handlePdfExport} className="gap-2 text-xs">
        <FileText className="h-3.5 w-3.5" />
        Download PDF
      </Button>
    </div>
  );
});

ExportButtons.displayName = "ExportButtons";

export default ExportButtons;
