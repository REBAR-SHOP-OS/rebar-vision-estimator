// Review-draft template — reviewer workflow, not an issued drawing.
// Includes reviewer name field + change log, omits the "for fabrication" stamp.
// Validate metadata via validate-metadata.ts in mode "review_draft" before render.
import { SHEET_SIZES_PT, type SheetSize } from "../sheet-sizes";

export function renderReviewDraftHtml(opts: {
  size?: SheetSize;
  projectName: string;
  sheetNumber: string;
  reviewerName: string;
  imageUrl: string;
  changes: Array<{ id: string; note: string; status: "open" | "resolved" }>;
}): string {
  const size = opts.size ?? "ARCH_C";
  const { w, h, label } = SHEET_SIZES_PT[size];
  const changeRows = opts.changes.map((c) =>
    `<tr><td>${c.id}</td><td>${c.note}</td><td>${c.status}</td></tr>`).join("");
  return `<!doctype html><html><head><style>
    @page { size: ${w}pt ${h}pt; margin: 0; }
    body { margin: 0; font-family: system-ui, sans-serif; }
    .sheet { width: ${w}pt; height: ${h}pt; display: grid;
      grid-template-columns: 1fr 3in; grid-template-rows: 1in 1fr 2in;
      grid-template-areas: "h r" "d r" "f r"; border: 2px solid #2563eb; }
    .h { grid-area: h; display: flex; justify-content: space-between; align-items: center; padding: 0.15in 0.3in; border-bottom: 1px solid #ccc; }
    .pill { background: #2563eb; color: white; padding: 4px 10px; font-size: 9pt; font-weight: 700; }
    .d { grid-area: d; padding: 0.1in; }
    .d img { width: 100%; height: 100%; object-fit: contain; }
    .r { grid-area: r; padding: 0.15in; border-left: 1px solid #ccc; font-size: 9pt; }
    .f { grid-area: f; padding: 0.15in 0.3in; border-top: 1px solid #ccc; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; }
    td, th { border: 1px solid #ddd; padding: 4px 6px; text-align: left; }
  </style></head><body><div class="sheet">
    <div class="h"><b>${opts.projectName}</b><span class="pill">REVIEW DRAFT</span></div>
    <div class="d"><img src="${opts.imageUrl}"/></div>
    <div class="r">
      <div><b>SHEET</b> ${opts.sheetNumber}</div>
      <div><b>SIZE</b> ${label}</div>
      <div><b>REVIEWER</b> ${opts.reviewerName}</div>
      <div><b>OPEN ISSUES</b> ${opts.changes.filter((c) => c.status === "open").length}</div>
    </div>
    <div class="f"><b>Change log</b>
      <table><thead><tr><th>ID</th><th>Note</th><th>Status</th></tr></thead><tbody>${changeRows}</tbody></table>
    </div>
  </div></body></html>`;
}