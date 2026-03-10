import { getMassKgPerM } from "@/lib/rebar-weights";
import { getLogoDataUri } from "@/lib/logo-base64";

interface PdfExportParams {
  quoteResult: any;
  elements: any[];
  scopeData?: any;
  projectId?: string;
}

export async function exportPdfFile({ quoteResult, elements, scopeData, projectId }: PdfExportParams): Promise<void> {
  const logoDataUri = await getLogoDataUri().catch(() => "");
  const barList: any[] = quoteResult.quote.bar_list || [];
  const sizeBreakdownKg: Record<string, number> = quoteResult.quote.size_breakdown_kg || {};
  const sizeBreakdownLbs: Record<string, number> = quoteResult.quote.size_breakdown || {};
  const totalLbs = quoteResult.quote.total_weight_lbs;
  const totalKg = quoteResult.quote.total_weight_kg || (totalLbs ? totalLbs * 0.453592 : 0);
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const isBlocked = quoteResult.quote.job_status === "VALIDATION_FAILED" || quoteResult.quote.job_status === "BLOCKED";
  const isFlagged = quoteResult.quote.reconciliation?.risk_level === "FLAG" || quoteResult.quote.job_status === "FLAGGED";

  // Variables used later for blob download
  let html = "";

  const hasSizeKg = Object.keys(sizeBreakdownKg).length > 0;
  const allSizes = new Set([...Object.keys(sizeBreakdownKg), ...Object.keys(sizeBreakdownLbs)]);
  const sizeEntries: [string, number][] = [];
  for (const size of allSizes) {
    const kg = hasSizeKg ? (sizeBreakdownKg[size] || (sizeBreakdownLbs[size] || 0) * 0.453592) : (sizeBreakdownLbs[size] || 0) * 0.453592;
    if (kg > 0) sizeEntries.push([size, kg]);
  }
  sizeEntries.sort((a, b) => parseInt(a[0].replace(/[^0-9]/g, "")) - parseInt(b[0].replace(/[^0-9]/g, "")));

  const elemWeights: Record<string, number> = {};
  const computedSizeKg: Record<string, number> = {};
  for (const b of barList) {
    const t = b.element_type || "OTHER";
    const mult = b.multiplier || 1;
    const qty = b.qty || 0;
    const lengthMm = b.length_mm || (b.length_ft ? b.length_ft * 304.8 : 0);
    const totalLenM = (qty * mult * lengthMm) / 1000;
    const massKgM = getMassKgPerM(b.size);
    const wtKg = (typeof b.weight_kg === "number" && b.weight_kg > 0) ? b.weight_kg : totalLenM * massKgM;
    elemWeights[t] = (elemWeights[t] || 0) + wtKg;
    const sz = b.size || "OTHER";
    computedSizeKg[sz] = (computedSizeKg[sz] || 0) + wtKg;
  }
  const elemEntries = Object.entries(elemWeights).sort((a, b) => b[1] - a[1]);

  const totalSizeKg = sizeEntries.reduce((s, e) => s + e[1], 0);
  const totalElemKg = elemEntries.reduce((s, e) => s + e[1], 0);

  const mmToFtIn = (mm: number): string => {
    if (!mm) return "";
    const totalInches = mm / 25.4;
    const ft = Math.floor(totalInches / 12);
    const inches = Math.round(totalInches % 12);
    return ft > 0 ? `${ft}'-${inches}"` : `${inches}"`;
  };

  const sizeRowsHtml = sizeEntries.map(([size, kg]) =>
    `<tr><td>${size}</td><td>${(Math.round(kg * 10) / 10).toLocaleString()}</td></tr>`
  ).join("");

  const elemRowsHtml = elemEntries.map(([elem, kg], i) =>
    `<tr><td>${i + 1}</td><td>${elem}</td><td>${(Math.round(kg * 10) / 10).toLocaleString()}</td></tr>`
  ).join("");

  const grouped: Record<string, any[]> = {};
  for (const b of barList) { const t = b.element_type || "OTHER"; if (!grouped[t]) grouped[t] = []; grouped[t].push(b); }

  let barRowsHtml = "";
  let slNo = 1;
  let grandTotalKg = 0;
  let grandTotalLenM = 0;

  for (const [elemType, bars] of Object.entries(grouped)) {
    barRowsHtml += `<tr class="group-header"><td colspan="13">${elemType.toUpperCase()}</td></tr>`;
    const subGrouped: Record<string, any[]> = {};
    for (const b of bars) { const k = b.sub_element || b.element_id || ""; if (!subGrouped[k]) subGrouped[k] = []; subGrouped[k].push(b); }

    for (const [subElem, subBars] of Object.entries(subGrouped)) {
      if (subElem && subElem !== elemType) {
        barRowsHtml += `<tr class="sub-header"><td colspan="13">${subElem}</td></tr>`;
      }
      for (const b of subBars) {
        const mult = b.multiplier || 1;
        const qty = b.qty || 0;
        const lengthMm = b.length_mm || (b.length_ft ? b.length_ft * 304.8 : 0);
        const totalPieces = qty * mult;
        const totalLenM = (totalPieces * lengthMm) / 1000;
        const massKgM = getMassKgPerM(b.size);
        const wtKg = typeof b.weight_kg === "number" ? b.weight_kg : totalLenM * massKgM;
        const isBent = b.shape_code && b.shape_code !== "straight" && b.shape_code !== "STRAIGHT";
        const spacing = b.spacing ? ` @ ${b.spacing}` : "";
        const desc = b.description || b.bar_mark || "";
        const identification = `${b.size || ""}${spacing}${desc ? " " + desc : ""}`.trim();

        barRowsHtml += `<tr><td>${slNo}</td><td>${identification}</td><td>${mult}</td><td>${qty}</td><td>${b.size || ""}</td><td>${mmToFtIn(lengthMm)}</td><td>${Math.round(lengthMm).toLocaleString()}</td><td>${isBent ? "BEND BARS" : "STRAIGHT BARS"}</td><td>${b.info1 || b.shape_code || ""}</td><td>${b.info2 || ""}</td><td>${(Math.round(totalLenM * 1000) / 1000).toFixed(3)}</td><td>${(Math.round(wtKg * 10) / 10).toFixed(1)}</td><td>${b.notes || ""}</td></tr>`;
        slNo++;
        grandTotalKg += wtKg;
        grandTotalLenM += totalLenM;
      }
    }
  }

  const meshDetails: any[] = quoteResult.quote.mesh_details || scopeData?.meshDetails || [];
  const meshHtml = meshDetails.length > 0
    ? meshDetails.map((m: any) => `<tr><td>${m.location || ""}</td><td>${m.mesh_size || ""}</td><td>${m.area_sqft || ""}</td></tr>`).join("")
    : `<tr><td>N/A</td><td></td><td></td></tr>`;

  const recon = quoteResult.quote.reconciliation || {};
  const reconHtml = recon.variance_pct !== undefined ? `
  <div class="page-break">
    <div class="section-title">Reconciliation Summary</div>
    <table style="max-width:600px">
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Drawing-Based Total (kg)</td><td>${(Math.round((recon.drawing_based_total || grandTotalKg) * 10) / 10).toLocaleString()}</td></tr>
      <tr><td>Industry Norm Total (kg)</td><td>${(Math.round((recon.industry_norm_total || 0) * 10) / 10).toLocaleString()}</td></tr>
      <tr><td>Variance</td><td>${recon.variance_pct?.toFixed(1)}%</td></tr>
      <tr class="${recon.risk_level === 'RISK_ALERT' ? 'risk-alert' : recon.risk_level === 'FLAG' ? 'risk-flag' : ''}"><td>Risk Level</td><td><strong>${recon.risk_level || "OK"}</strong></td></tr>
    </table>
    ${recon.notes ? `<p style="margin-top:8px;font-size:10px;color:#666">${recon.notes}</p>` : ""}
  </div>` : "";

  const riskFlags: string[] = quoteResult.quote.risk_flags || [];
  const riskHtml = riskFlags.length > 0 ? `
  <div style="margin-top:16px">
    <div class="section-title" style="font-size:13px">Risk Flags</div>
    <ul style="font-size:10px;color:#c0392b">${riskFlags.map(f => `<li>⚠ ${f}</li>`).join("")}</ul>
  </div>` : "";

  const auditTrace = quoteResult.quote.audit_trace || {};
  const auditHtml = auditTrace.stage_hashes?.length ? `
  <div style="margin-top:16px">
    <div class="section-title" style="font-size:13px">Audit Summary</div>
    <table style="max-width:700px;font-size:9px">
      <tr><th>Stage</th><th>Hash (first 16)</th></tr>
      ${auditTrace.stage_hashes.map((h: any, i: number) => `<tr><td>Stage ${i}</td><td style="font-family:monospace">${typeof h === 'string' ? h.substring(0, 16) + '…' : JSON.stringify(h).substring(0, 16) + '…'}</td></tr>`).join("")}
    </table>
  </div>` : "";

  const warningBanner = isBlocked ? `<div style="background:#c0392b;color:#fff;padding:10px 16px;margin-bottom:16px;border-radius:4px;font-weight:700">⚠ WARNING: This estimate has status BLOCKED. Results may be incomplete or invalid.</div>` :
    isFlagged ? `<div style="background:#e67e22;color:#fff;padding:10px 16px;margin-bottom:16px;border-radius:4px;font-weight:700">⚠ NOTICE: This estimate has been flagged for review. Verify results before use.</div>` : "";

  const projectSlug = (scopeData?.projectName || "rebar-takeoff").replace(/\s+/g, "_");
  const timestamp = new Date().toISOString();

  html = `<!DOCTYPE html><html><head><title>${projectSlug} — Estimate Report</title>
<style>
@page{margin:0.6in;size:letter landscape}
*{box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;margin:0;padding:30px;font-size:11px;background:#fff}
.header{margin-bottom:16px;background:#8DB4B4;padding:10px 14px;border:1px solid #7a9e9e}
.header h1{margin:0;font-size:20px;color:#1a1a2e}
.meta-row{display:flex;gap:4px;font-size:11px;margin:2px 0;background:#8DB4B4;padding:2px 14px;border:1px solid #7a9e9e}
.meta-row .label{font-weight:600;min-width:110px}
.section-title{font-size:16px;font-weight:700;color:#fff;background:#92D050;padding:6px 14px;margin:18px 0 10px;text-align:center}
.side-by-side{display:flex;gap:40px;margin-bottom:20px}
.side-by-side .panel{flex:1}
.panel h3{font-size:12px;font-weight:700;margin:0 0 6px;text-transform:uppercase;text-decoration:underline;color:#333}
table{width:100%;border-collapse:collapse;font-size:10px}
th{background:#D9E1F2;color:#1a1a2e;padding:5px 6px;text-align:left;font-weight:600;font-size:9px;text-transform:uppercase;border:1px solid #999}
td{padding:4px 6px;border:1px solid #ccc}
tr:nth-child(even){background:#f9f9fb}
.grand-total td{background:#FFFF00;color:#1a1a2e;font-weight:700;border:1px solid #999}
.group-header td{background:#FFFF00;font-weight:700;font-size:10px;border:1px solid #999}
.sub-header td{background:#DCE6F1;font-weight:600;font-style:italic;font-size:10px;border:1px solid #999}
.notes-section{margin-top:20px;font-size:11px}
.notes-section .note-row{display:flex;gap:4px;margin:2px 0}
.notes-section .note-label{font-weight:600;min-width:130px}
.notes-header{font-size:14px;font-weight:700;color:#fff;background:#92D050;padding:6px 14px;margin:18px 0 10px}
.page-break{page-break-before:always}
.footer{margin-top:30px;padding-top:8px;border-top:1px solid #ccc;font-size:9px;color:#999;text-align:center}
.bar-list-table th{background:#FFC7CE;color:#1a1a2e;font-weight:600;font-size:9px;padding:4px 5px;border:1px solid #999;text-align:center;white-space:nowrap}
.bar-list-table td{font-size:9px;padding:3px 4px;white-space:nowrap;border:1px solid #ccc}
.risk-alert td{background:#c0392b;color:#fff;font-weight:700}
.risk-flag td{background:#e67e22;color:#fff;font-weight:700}
.proj-header{background:#8DB4B4;padding:6px 14px;font-size:14px;font-weight:700;border:1px solid #7a9e9e;margin-bottom:10px}
.logo-header{display:flex;align-items:center;gap:14px;margin-bottom:16px;background:#8DB4B4;padding:10px 14px;border:1px solid #7a9e9e}
.logo-header img{height:50px;width:50px;border-radius:50%;object-fit:cover}
.logo-header h1{margin:0;font-size:20px;color:#1a1a2e}
</style></head><body>

${warningBanner}

<!-- SECTION 1: ESTIMATE SUMMARY -->
<div class="logo-header">${logoDataUri ? `<img src="${logoDataUri}" alt="Logo"/>` : ""}<h1>Rebar Estimation Report</h1></div>
<div class="meta-row"><span class="label">Project Name :</span><span>${scopeData?.projectName || "—"}</span></div>
<div class="meta-row"><span class="label">Address :</span><span>${scopeData?.address || ""}</span></div>
<div class="meta-row"><span class="label">Engineer :</span><span>${scopeData?.engineer || ""}</span></div>
<div class="meta-row"><span class="label">Customer :</span><span>${scopeData?.clientName || "—"}</span></div>
<div class="meta-row"><span class="label">Product Line :</span><span>${scopeData?.coatingType || "Black Steel"}</span></div>
<div class="meta-row"><span class="label">Estimator :</span><span>${scopeData?.estimator || "—"}</span></div>
<div class="meta-row"><span class="label">Created Date :</span><span>${dateStr}</span></div>

<div class="section-title">Estimate Summary</div>
<div class="side-by-side">
  <div class="panel">
    <h3>Weight Summary Report in Kgs</h3>
    <table><tr><th>Bar Size</th><th>Weight (kg)</th></tr>${sizeRowsHtml}
    <tr class="grand-total"><td>Grand Total (kg)</td><td>${(Math.round(totalSizeKg * 10) / 10).toLocaleString()}</td></tr>
    <tr class="grand-total"><td>Grand Total (Tons)</td><td>${(totalSizeKg / 1000).toFixed(2)}</td></tr></table>
  </div>
  <div class="panel">
    <h3>Element wise Summary Report in Kgs</h3>
    <table><tr><th>S.No.</th><th>Element</th><th>Weight (kg)</th></tr>${elemRowsHtml}
    <tr class="grand-total"><td></td><td>Grand Total (kg)</td><td>${(Math.round(totalElemKg * 10) / 10).toLocaleString()}</td></tr>
    <tr class="grand-total"><td></td><td>Grand Total (Tons)</td><td>${(totalElemKg / 1000).toFixed(2)}</td></tr></table>
  </div>
</div>

<div class="notes-section">
  <div class="notes-header">Notes</div>
  <div class="note-row"><span class="note-label">Grade :</span><span>${scopeData?.rebarGrade || "400W"}</span></div>
  <div class="note-row"><span class="note-label">Deviations :</span><span>${scopeData?.deviations || "None"}</span></div>
  <div class="note-row"><span class="note-label">Coating :</span><span>${scopeData?.coatingType || "Black Steel"}</span></div>
  ${(() => {
    const lapTable = scopeData?.lapLengthTable;
    if (lapTable && Array.isArray(lapTable) && lapTable.length > 0) {
      return `<div style="margin-top:8px"><strong>Lap Length Details:</strong>
        <table style="max-width:400px;margin-top:4px"><tr><th>Bar Dia.</th><th>Bot Lap</th><th>Top Lap</th></tr>
        ${lapTable.map((r: any) => `<tr><td>${r.size || ""}</td><td>${r.bot_lap || ""}</td><td>${r.top_lap || ""}</td></tr>`).join("")}
        </table></div>`;
    }
    return `<div class="note-row"><span class="note-label">Lap Length Info :</span><span>${scopeData?.lapLength || "As per Manual of Standard Practice"}</span></div>`;
  })()}
</div>

${scopeData?.scopeItems?.length ? `<div style="margin-top:12px"><strong>SCOPE ITEMS INCLUDED</strong><ul style="margin:4px 0">${scopeData.scopeItems.map((s: string) => `<li>${s}</li>`).join("")}</ul></div>` : ""}

<div style="margin-top:16px">
  <div class="notes-header">Mesh Details</div>
  <table style="max-width:500px"><tr><th>Location</th><th>Mesh Size</th><th>Total Area (SQFT)</th></tr>${meshHtml}</table>
</div>

${riskHtml}

<!-- SECTION 2: BAR LIST -->
<div class="page-break">
  <div class="proj-header">Bar List — ${scopeData?.projectName || "Project"}</div>
  <table class="bar-list-table">
    <tr><th>SL.No.</th><th>Identification</th><th>Mult.</th><th>Qty</th><th>Bar Dia</th><th>Length ft-in</th><th>Length mm</th><th>Bend</th><th>Info 1</th><th>Info 2 (@)</th><th>Total Len (Mtr.)</th><th>Total Wgt kg</th><th>Notes</th></tr>
    ${barRowsHtml}
    <tr class="grand-total"><td colspan="10" style="text-align:right">TOTAL WEIGHT</td><td>${(Math.round(grandTotalLenM * 1000) / 1000).toFixed(3)}</td><td>${(Math.round(grandTotalKg * 10) / 10).toFixed(1)}</td><td></td></tr>
    <tr class="grand-total"><td colspan="10" style="text-align:right">TOTAL (Tons)</td><td></td><td>${(grandTotalKg / 1000).toFixed(2)}</td><td></td></tr>
  </table>
  <div style="margin-top:16px">
    <strong>MESH DETAILS</strong>
    <table style="max-width:500px;margin-top:4px"><tr><th>Location</th><th>Mesh Size</th><th>Total Area (SQFT)</th></tr>${meshHtml}</table>
  </div>
</div>

${reconHtml}
${auditHtml}

<div class="footer">Project ID: ${projectId || "—"} &bull; Generated by Rebar Estimator Pro v2026-03-10 (Rev B) &bull; ${timestamp}</div>
</body></html>`;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 400);
    };
  } else {
    // Fallback if popup blocked: download as HTML
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectSlug}_estimate_report.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
