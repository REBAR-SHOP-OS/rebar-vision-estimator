// ISSUED drawing template — deterministic, fabrication-grade.
// PRECONDITION: validate-metadata.ts in mode "issued" returned ok=true.
// All title-block fields are mandatory.
import { SHEET_SIZES_PT, type SheetSize } from "../sheet-sizes";

export interface IssuedSheetMeta {
  projectName: string;
  clientName: string;
  sheetNumber: string;
  scale: string;
  discipline: string;
  issueDate: string; // YYYY-MM-DD
  drawnBy: string;
  checkedBy: string;
  approvedBy: string;
  revisionLabel: string; // R0, R1, ...
  imageUrl: string;
}

export function renderIssuedHtml(meta: IssuedSheetMeta, size: SheetSize = "ARCH_D"): string {
  const { w, h, label } = SHEET_SIZES_PT[size];
  return `<!doctype html><html><head><style>
    @page { size: ${w}pt ${h}pt; margin: 0; }
    body { margin: 0; font-family: system-ui, sans-serif; }
    .sheet { width: ${w}pt; height: ${h}pt; display: grid;
      grid-template-columns: 1fr 3.5in; grid-template-rows: 0.8in 1fr 2.2in;
      grid-template-areas: "h tb" "d tb" "f tb"; border: 3px solid black; }
    .h { grid-area: h; padding: 0.15in 0.3in; border-bottom: 2px solid black; display: flex; justify-content: space-between; align-items: center; }
    .d { grid-area: d; padding: 0.1in; }
    .d img { width: 100%; height: 100%; object-fit: contain; }
    .tb { grid-area: tb; border-left: 2px solid black; padding: 0.2in; font-size: 10pt; }
    .tb .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #ddd; }
    .f { grid-area: f; border-top: 2px solid black; padding: 0.15in 0.3in; }
    .stamp { background: black; color: white; padding: 4px 10px; font-weight: 700; font-size: 10pt; }
  </style></head><body><div class="sheet">
    <div class="h"><b>${meta.projectName}</b><span class="stamp">ISSUED FOR ${meta.discipline.toUpperCase()}</span></div>
    <div class="d"><img src="${meta.imageUrl}"/></div>
    <div class="tb">
      <div class="row"><span>CLIENT</span><span>${meta.clientName}</span></div>
      <div class="row"><span>SHEET</span><span>${meta.sheetNumber}</span></div>
      <div class="row"><span>SIZE</span><span>${label}</span></div>
      <div class="row"><span>SCALE</span><span>${meta.scale}</span></div>
      <div class="row"><span>DISCIPLINE</span><span>${meta.discipline}</span></div>
      <div class="row"><span>ISSUE</span><span>${meta.issueDate}</span></div>
      <div class="row"><span>REV</span><span>${meta.revisionLabel}</span></div>
      <div class="row"><span>DRAWN</span><span>${meta.drawnBy}</span></div>
      <div class="row"><span>CHECKED</span><span>${meta.checkedBy}</span></div>
      <div class="row"><span>APPROVED</span><span>${meta.approvedBy}</span></div>
    </div>
    <div class="f"><i>This drawing is issued for fabrication. Field-verify before construction.</i></div>
  </div></body></html>`;
}