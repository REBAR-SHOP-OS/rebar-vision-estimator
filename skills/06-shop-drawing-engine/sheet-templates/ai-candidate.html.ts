import { SHEET_SIZES_PT, type SheetSize } from "../sheet-sizes";

export interface AiCandidateSheet {
  imageUrl: string;
  caption?: string;
  sheetNumber: string;          // AI-CANDIDATE-01
  projectName: string;
  segmentLabel?: string;
}

export function renderAiCandidateHtml(opts: {
  sheets: AiCandidateSheet[];
  size?: SheetSize;
}): string {
  const size = opts.size ?? "ARCH_C";
  const { w, h, label } = SHEET_SIZES_PT[size];
  const sheets = opts.sheets.map((s, i) => `
    <section class="sheet">
      <div class="frame">
        <div class="zone-header">
          <div class="title">${escape(s.projectName)}${s.segmentLabel ? ` — ${escape(s.segmentLabel)}` : ""}</div>
          <div class="pill">UNVERIFIED — AI CANDIDATE</div>
        </div>
        <div class="zone-drawable">
          <img src="${s.imageUrl}" class="sheet-image" alt="AI candidate ${i + 1}"/>
          <div class="unverified-band">AI sketch — not for fabrication</div>
        </div>
        <div class="zone-rail">
          <div class="cell"><b>SHEET</b><span>${escape(s.sheetNumber)}</span></div>
          <div class="cell"><b>SIZE</b><span>${label}</span></div>
          <div class="cell"><b>SCALE</b><span>Schematic — N.T.S.</span></div>
          <div class="cell"><b>MATCH</b><span class="warn">Pending</span></div>
          <div class="cell"><b>REVIEW</b><span class="warn">Unreviewed</span></div>
          ${s.caption ? `<div class="cell flex"><b>CAPTION</b><span>${escape(s.caption)}</span></div>` : ""}
        </div>
        <div class="zone-footer">
          <div class="legend">▣ Candidate &nbsp; ▣ AI Note &nbsp; ▣ Unverified &nbsp; ▣ Source ref</div>
          <div class="warn-text">Marks, quantities and changes shown are AI suggestions. Not for fabrication.</div>
        </div>
        <div class="watermark">AI VISUAL DRAFT — NOT FOR FABRICATION</div>
      </div>
    </section>
  `).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page { size: ${w}pt ${h}pt; margin: 0; }
    html, body { margin: 0; padding: 0; font-family: -apple-system, system-ui, sans-serif; }
    .sheet { width: ${w}pt; height: ${h}pt; page-break-after: always; position: relative; }
    .sheet:last-child { page-break-after: auto; }
    .frame {
      width: 100%; height: 100%;
      display: grid;
      grid-template-columns: 1fr 2.9in;
      grid-template-rows: 1.1in 1fr 1.8in;
      grid-template-areas: "header rail" "drawable rail" "footer rail";
      border: 2px dashed #d97706;
    }
    .zone-header { grid-area: header; display: flex; align-items: center; justify-content: space-between; padding: 0.1in 0.25in; border-bottom: 1px solid #ccc; }
    .title { font-weight: 700; font-size: 14pt; }
    .pill { background: #b91c1c; color: white; padding: 4px 10px; border-radius: 3px; font-size: 9pt; font-weight: 700; }
    .zone-drawable { grid-area: drawable; position: relative; background-image: radial-gradient(#0001 1px, transparent 1px); background-size: 0.5in 0.5in; }
    .sheet-image { width: 100%; height: 100%; object-fit: contain; border: 1px dashed #d97706; }
    .unverified-band { position: absolute; left: 0; right: 0; bottom: 0; height: 15px; background: rgba(217,119,6,0.85); color: white; font-size: 9pt; font-weight: 700; text-align: center; line-height: 15px; }
    .zone-rail { grid-area: rail; display: flex; flex-direction: column; gap: 0.05in; padding: 0.1in; border-left: 1px solid #ccc; background: #fafafa; }
    .cell { display: flex; flex-direction: column; padding: 4px 7px; background: white; border: 1px solid #eee; font-size: 9pt; }
    .cell.flex { flex: 1; }
    .cell b { font-size: 8pt; color: #666; }
    .warn { color: #b91c1c; font-weight: 700; }
    .zone-footer { grid-area: footer; display: grid; grid-template-columns: 1fr 1.4fr; gap: 0.2in; padding: 0.15in 0.25in; border-top: 1px solid #ccc; font-size: 10pt; }
    .watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transform: rotate(-30deg); font-size: 60pt; color: rgba(217,119,6,0.07); font-weight: 900; pointer-events: none; }
  </style></head><body>${sheets}</body></html>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}