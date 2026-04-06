export interface ShopDrawingOptions {
  scale?: string;
  includeDims?: boolean;
  layerGrouping?: boolean;
  barMarks?: boolean;
  drawingPrefix?: string;
  notes?: string;
  /** Optional: file name of uploaded estimate spreadsheet for title-block reference */
  estimateFileName?: string;
}

export interface ShopDrawingBar {
  element_id?: string;
  element_type?: string;
  sub_element?: string;
  bar_mark?: string;
  size?: string;
  shape_code?: string;
  qty?: number;
  multiplier?: number;
  length_mm?: number;
  length_ft?: number;
  weight_kg?: number;
  spacing?: string | number;
  description?: string;
  notes?: string;
  info1?: string;
  info2?: string;
  leg_a?: number;
  leg_b?: number;
  leg_c?: number;
  leg_d?: number;
}

export interface ShopDrawingElement {
  element_id?: string;
  element_type?: string;
  page_number?: number;
  bbox?: [number, number, number, number];
  regions?: {
    tag_region?: {
      bbox?: number[];
      page_number?: number;
    };
  };
}

export interface BuildShopDrawingParams {
  barList?: ShopDrawingBar[];
  elements?: ShopDrawingElement[];
  projectName?: string;
  clientName?: string;
  standard?: string;
  coatingType?: string;
  sizeBreakdown?: Record<string, number>;
  options?: ShopDrawingOptions;
  dateStr?: string;
  logoDataUri?: string;
  /** Text extracted from an optional uploaded estimate workbook (CSV/XLSX) */
  estimateContext?: string;
}

interface NormalizedBar {
  elementId: string;
  elementType: string;
  subgroup: string;
  barMark: string;
  size: string;
  shapeCode: string;
  qty: number;
  multiplier: number;
  pieces: number;
  lengthMm: number;
  totalLengthM: number;
  weightKg: number;
  note: string;
  legA?: number;
  legB?: number;
  legC?: number;
  legD?: number;
}

// ── Helpers ─────────────────────────────────────────────────

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function normalizeShapeCode(shapeCode: unknown): string {
  const raw = String(shapeCode || "STRAIGHT").trim().toUpperCase();
  if (!raw || raw === "0" || raw === "STRAIGHT") return "STRAIGHT";
  if (raw === "CLOSED") return "CLOSED";
  return raw;
}

function inferLengthMm(bar: ShopDrawingBar): number {
  const lengthMm = toNumber(bar.length_mm);
  if (lengthMm > 0) return lengthMm;
  const lengthFt = toNumber(bar.length_ft);
  return lengthFt > 0 ? Math.round(lengthFt * 304.8) : 0;
}

function inferWeightKg(bar: ShopDrawingBar, totalLengthM: number): number {
  const supplied = toNumber(bar.weight_kg);
  if (supplied > 0) return supplied;
  const kgPerM: Record<string, number> = {
    "10M": 0.785, "15M": 1.57, "20M": 2.355, "25M": 3.925,
    "30M": 5.495, "35M": 7.85, "4M": 0.25, "5M": 0.395,
    "6M": 0.56, "#3": 0.56, "#4": 0.994, "#5": 1.552,
    "#6": 2.235, "#7": 3.042, "#8": 3.973,
  };
  const normalizedSize = String(bar.size || "").trim().toUpperCase();
  return totalLengthM * (kgPerM[normalizedSize] || 0);
}

function normalizeBars(barList: ShopDrawingBar[]): NormalizedBar[] {
  return barList
    .map((bar, index) => {
      const qty = Math.max(1, Math.round(toNumber(bar.qty) || 1));
      const multiplier = Math.max(1, Math.round(toNumber(bar.multiplier) || 1));
      const lengthMm = inferLengthMm(bar);
      const pieces = qty * multiplier;
      const totalLengthM = (pieces * lengthMm) / 1000;
      const weightKg = inferWeightKg(bar, totalLengthM);
      return {
        elementId: String(bar.element_id || bar.sub_element || `ROW-${index + 1}`).trim(),
        elementType: String(bar.element_type || "OTHER").trim() || "OTHER",
        subgroup: String(bar.sub_element || bar.description || bar.element_id || "").trim(),
        barMark: String(bar.bar_mark || bar.description || `BM-${index + 1}`).trim(),
        size: String(bar.size || "—").trim() || "—",
        shapeCode: normalizeShapeCode(bar.shape_code),
        qty, multiplier, pieces, lengthMm, totalLengthM, weightKg,
        note: [
          bar.spacing ? `Spacing ${bar.spacing}` : "",
          bar.info1 ? String(bar.info1).trim() : "",
          bar.info2 ? String(bar.info2).trim() : "",
          bar.notes ? String(bar.notes).trim() : "",
        ].filter(Boolean).join(" | "),
        legA: toNumber(bar.leg_a) || undefined,
        legB: toNumber(bar.leg_b) || undefined,
        legC: toNumber(bar.leg_c) || undefined,
        legD: toNumber(bar.leg_d) || undefined,
      };
    })
    .sort((a, b) => {
      if (a.elementType !== b.elementType) return a.elementType.localeCompare(b.elementType);
      if (a.elementId !== b.elementId) return a.elementId.localeCompare(b.elementId);
      return a.barMark.localeCompare(b.barMark, undefined, { numeric: true, sensitivity: "base" });
    });
}

/** Minimum placing-drawing views by element family (aligns with analyzer drawing_view_policy). */
export function requiredViewsForElementType(elementType: string): string[] {
  const t = elementType.toUpperCase();
  if (/^(PILE|CAISSON|FOOTING|RAFT_SLAB|RAFT|EQUIPMENT_PAD|TRANSFORMER_PAD|ELEVATOR_PIT|SUMP_PIT|THICKENED_EDGE)$/.test(t) || /PAD|PIT/.test(t)) {
    return ["Plan (top)", "Section(s)", "Detail(s) if stepped, sloped, thickened, or congested"];
  }
  if (/WALL|RETAINING|ICF|CMU|SHEAR/.test(t)) {
    return ["Elevation", "Horizontal section", "Vertical section", "End/detail if corners, openings, embeds, or laps are complex"];
  }
  if (/SLAB|SOG|PAVING|SITE/.test(t)) {
    return ["Top/plan", "Section(s)", "Enlarged details at openings, drops, edges, joints, penetrations"];
  }
  if (/BEAM|BOND|GRADE_BEAM/.test(t)) {
    return ["Longitudinal elevation", "Cross-section(s)", "Stirrup/hoop details", "End anchorage if needed"];
  }
  if (/COLUMN|CAGE|PIER|LIGHT_POLE/.test(t)) {
    return ["Elevation", "Cross-section", "Tie/spiral detail", "Lap/splice zone if applicable"];
  }
  if (/STAIR|RAMP/.test(t)) {
    return ["Plan", "Long section", "Cross-section(s)", "Enlarged bending details as needed"];
  }
  if (/WIRE_MESH/.test(t)) {
    return ["Plan showing layout", "Support/chair/placement notes as applicable"];
  }
  return ["Primary orthographic view", "Section(s) where cover/layers/faces are unclear", "Detail(s) where ambiguity remains"];
}

function buildViewChecklistTableHtml(segmentBars: NormalizedBar[]): string {
  const types = Array.from(new Set(segmentBars.map((b) => b.elementType).filter(Boolean)));
  if (types.length === 0) {
    return `<div class="view-check-wrap"><div class="meta-title">Placing views (by element)</div><p class="meta-muted">No element types in this segment — add bar list element_type.</p></div>`;
  }
  const rows = types
    .sort((a, b) => a.localeCompare(b))
    .map((t) => {
      const v = requiredViewsForElementType(t);
      return `<tr><td>${escapeHtml(t)}</td><td>${escapeHtml(v.join(" · "))}</td></tr>`;
    })
    .join("");
  return `
    <div class="view-check-wrap">
      <div class="meta-title">Placing views (minimum checklist)</div>
      <table class="view-check-table">
        <thead><tr><th>Element type</th><th>Required views</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="meta-muted">Schedules supplement — they do not replace graphic views. Add sections/details when placement is ambiguous.</p>
    </div>`;
}

const ESTIMATE_CONTEXT_MAX = 7000;

function buildMetaStripHtml(
  segmentBars: NormalizedBar[],
  sheetIndex: number,
  totalSheets: number,
  notes: string,
  estimateContext: string,
  estimateFileName: string,
): string {
  const notesBlock = notes.trim()
    ? `<div class="meta-block"><div class="meta-title">Special notes</div><div class="meta-body">${escapeHtml(notes.trim())}</div></div>`
    : "";

  let estimateBlock = "";
  const estRaw = estimateContext.trim();
  if (estRaw || estimateFileName) {
    const capped = estRaw.length > ESTIMATE_CONTEXT_MAX ? `${estRaw.slice(0, ESTIMATE_CONTEXT_MAX)}\n… [truncated]` : estRaw;
    const fileLine = estimateFileName ? ` — ${escapeHtml(estimateFileName)}` : "";
    if (sheetIndex === 0) {
      estimateBlock = `
        <div class="meta-block">
          <div class="meta-title">Estimate upload${fileLine}</div>
          ${capped ? `<pre class="estimate-pre">${escapeHtml(capped)}</pre>` : `<p class="meta-muted">(File name only — no tabular text parsed.)</p>`}
        </div>`;
    } else if (capped) {
      estimateBlock = `
        <div class="meta-block">
          <div class="meta-title">Estimate upload${fileLine}</div>
          <p class="meta-muted">Full extract on sheet 1 of ${totalSheets}.</p>
        </div>`;
    }
  }

  const hasRightColumn = Boolean(estimateBlock || notesBlock);

  return `
    <div class="sheet-meta-strip${hasRightColumn ? "" : " sheet-meta-strip--views-only"}">
      ${buildViewChecklistTableHtml(segmentBars)}
      <div class="meta-grid">${estimateBlock}${notesBlock}</div>
    </div>`;
}

// ── Shape SVGs ──────────────────────────────────────────────

function buildShapeSvg(shapeCode: string): string {
  switch (shapeCode) {
    case "17":
      return `<svg viewBox="0 0 180 100" class="shape-svg"><path d="M30 75 L30 25 L140 25"/><path class="dim" d="M18 75 L18 25 M18 25 L30 25 M18 75 L30 75"/><path class="dim" d="M30 12 L140 12 M30 12 L30 25 M140 12 L140 25"/><text x="10" y="52">A</text><text x="82" y="8">B</text></svg>`;
    case "31":
      return `<svg viewBox="0 0 180 100" class="shape-svg"><path d="M28 72 L70 72 L112 28 L152 28"/><path class="dim" d="M28 84 L70 84 M28 84 L28 72 M70 84 L70 72"/><path class="dim" d="M112 16 L152 16 M112 16 L112 28 M152 16 L152 28"/><text x="44" y="96">A</text><text x="126" y="12">B</text><text x="78" y="58">C</text></svg>`;
    case "T1":
      return `<svg viewBox="0 0 180 100" class="shape-svg"><path d="M38 72 L38 28 L142 28 L142 72"/><path class="dim" d="M24 72 L24 28 M24 28 L38 28 M24 72 L38 72"/><path class="dim" d="M38 14 L142 14 M38 14 L38 28 M142 14 L142 28"/><path class="dim" d="M156 28 L156 72 M142 28 L156 28 M142 72 L156 72"/><text x="14" y="53">A</text><text x="86" y="10">B</text><text x="160" y="53">C</text></svg>`;
    case "T12":
      return `<svg viewBox="0 0 180 100" class="shape-svg"><path d="M26 66 L126 66 Q148 66 148 44 L148 24"/><path class="dim" d="M26 80 L126 80 M26 80 L26 66 M126 80 L126 66"/><path class="dim" d="M162 24 L162 44 M148 24 L162 24 M148 44 L162 44"/><text x="70" y="94">Length</text><text x="166" y="36">A</text></svg>`;
    case "2":
      return `<svg viewBox="0 0 180 100" class="shape-svg"><path d="M28 68 L124 68 Q146 68 146 46 L146 32"/><path class="dim" d="M28 82 L124 82 M28 82 L28 68 M124 82 L124 68"/><text x="70" y="94">Length</text><text x="126" y="24">Hook</text></svg>`;
    case "CLOSED":
      return `<svg viewBox="0 0 180 100" class="shape-svg"><rect x="38" y="24" width="104" height="48"/><path class="dim" d="M24 72 L24 24 M24 24 L38 24 M24 72 L38 72"/><path class="dim" d="M38 12 L142 12 M38 12 L38 24 M142 12 L142 24"/><text x="14" y="52">A</text><text x="86" y="8">B</text></svg>`;
    case "STRAIGHT":
    default:
      return `<svg viewBox="0 0 180 100" class="shape-svg"><path d="M26 50 L154 50"/><path class="dim" d="M26 36 L154 36 M26 36 L26 50 M154 36 L154 50"/><text x="78" y="28">Length</text></svg>`;
  }
}

// ── Segment-based sheet building ────────────────────────────

const SEGMENT_BBS_LIMIT = 28;

interface SegmentGroup {
  segmentName: string;
  bars: NormalizedBar[];
}

function groupBySegment(bars: NormalizedBar[]): SegmentGroup[] {
  const map = new Map<string, NormalizedBar[]>();
  for (const bar of bars) {
    const key = bar.elementType || "GENERAL";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(bar);
  }
  return Array.from(map.entries()).map(([segmentName, segBars]) => ({
    segmentName: segmentName.toUpperCase(),
    bars: segBars,
  }));
}

function buildBbsTableHtml(bars: NormalizedBar[], options: Required<ShopDrawingOptions>): string {
  if (bars.length === 0) return `<div class="zone-empty">No bar data</div>`;

  const rows = bars.map((bar) => `
    <tr>
      <td>${escapeHtml(options.barMarks ? bar.barMark : bar.elementId)}</td>
      <td>${escapeHtml(bar.size)}</td>
      <td>${escapeHtml(bar.shapeCode)}</td>
      <td class="num">${formatNumber(bar.qty)}</td>
      <td class="num">${formatNumber(bar.multiplier)}</td>
      <td class="num">${formatNumber(bar.pieces)}</td>
      <td class="num">${bar.lengthMm > 0 ? formatNumber(bar.lengthMm) : "—"}</td>
      <td class="num">${bar.totalLengthM > 0 ? formatNumber(bar.totalLengthM, 2) : "—"}</td>
      <td class="num">${bar.weightKg > 0 ? formatNumber(bar.weightKg, 1) : "—"}</td>
      <td class="num">${options.includeDims && bar.legA ? formatNumber(bar.legA) : "—"}</td>
      <td class="num">${options.includeDims && bar.legB ? formatNumber(bar.legB) : "—"}</td>
      <td class="num">${options.includeDims && bar.legC ? formatNumber(bar.legC) : "—"}</td>
      <td class="num">${options.includeDims && bar.legD ? formatNumber(bar.legD) : "—"}</td>
      <td>${escapeHtml(bar.note || "—")}</td>
    </tr>`).join("");

  const totalWt = bars.reduce((s, b) => s + b.weightKg, 0);
  const totalLen = bars.reduce((s, b) => s + b.totalLengthM, 0);

  return `
    <table class="bbs-table">
      <thead><tr>
        <th>BM</th><th>Size</th><th>Shape</th>
        <th class="num">Qty</th><th class="num">Mult</th><th class="num">Pcs</th>
        <th class="num">Cut mm</th><th class="num">Total m</th><th class="num">Wt kg</th>
        <th class="num">A</th><th class="num">B</th><th class="num">C</th><th class="num">D</th>
        <th>Notes</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row">
        <td colspan="7"><strong>TOTAL</strong></td>
        <td class="num"><strong>${formatNumber(totalLen, 2)}</strong></td>
        <td class="num"><strong>${formatNumber(totalWt, 1)}</strong></td>
        <td colspan="5"></td>
      </tr></tfoot>
    </table>`;
}

function buildShapeKeysHtml(bars: NormalizedBar[]): string {
  const shapeMap = new Map<string, NormalizedBar[]>();
  for (const bar of bars) {
    if (!shapeMap.has(bar.shapeCode)) shapeMap.set(bar.shapeCode, []);
    shapeMap.get(bar.shapeCode)!.push(bar);
  }

  const cards = Array.from(shapeMap.entries())
    .sort((a, b) => {
      if (a[0] === "STRAIGHT") return -1;
      if (b[0] === "STRAIGHT") return 1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    })
    .slice(0, 8)
    .map(([code, shapeBars]) => {
      const marks = shapeBars.slice(0, 3).map(b => b.barMark).join(", ");
      return `
        <div class="shape-mini-card">
          <div class="shape-code-label">${escapeHtml(code)}</div>
          ${buildShapeSvg(code)}
          <div class="shape-marks">${escapeHtml(marks)}</div>
        </div>`;
    }).join("");

  return `<div class="shape-keys-grid">${cards}</div>`;
}

function buildPlanLayoutSvg(bars: NormalizedBar[], elements: ShopDrawingElement[]): string {
  // Schematic plan view — show element callouts in a grid
  const uniqueElements = Array.from(new Set(bars.map(b => b.elementId))).slice(0, 12);
  const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(uniqueElements.length))));
  const cellW = 180;
  const cellH = 80;
  const svgW = cols * cellW + 40;
  const rows = Math.ceil(uniqueElements.length / cols);
  const svgH = rows * cellH + 40;

  const rects = uniqueElements.map((elId, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 20 + col * cellW;
    const y = 20 + row * cellH;
    const elBars = bars.filter(b => b.elementId === elId);
    const sizes = Array.from(new Set(elBars.map(b => b.size))).join("/");
    return `
      <rect x="${x}" y="${y}" width="${cellW - 10}" height="${cellH - 10}" fill="none" stroke="#111" stroke-width="1.5"/>
      <text x="${x + 8}" y="${y + 20}" class="el-label">${escapeHtml(elId)}</text>
      <text x="${x + 8}" y="${y + 36}" class="el-size">${escapeHtml(sizes)}</text>
      <text x="${x + 8}" y="${y + 50}" class="el-count">${elBars.length} bars</text>`;
  }).join("");

  return `
    <svg viewBox="0 0 ${svgW} ${svgH}" class="plan-layout-svg" aria-label="Plan layout">
      <style>
        .el-label { font: bold 12px Arial; fill: #111; }
        .el-size { font: 10px Arial; fill: #333; }
        .el-count { font: 9px Arial; fill: #555; }
      </style>
      ${rects}
    </svg>`;
}

function buildSectionDetailSvg(): string {
  // Typical cross-section showing rebar placement
  return `
    <svg viewBox="0 0 280 160" class="section-svg" aria-label="Typical section">
      <style>
        .sec-label { font: 8px Arial; fill: #111; }
        .sec-dim { font: 7px Arial; fill: #333; }
      </style>
      <rect x="40" y="20" width="200" height="120" fill="none" stroke="#111" stroke-width="2"/>
      <circle cx="60" cy="40" r="5" fill="#111"/><text x="70" y="43" class="sec-label">TOP BAR</text>
      <circle cx="60" cy="120" r="5" fill="#111"/><text x="70" y="123" class="sec-label">BOT. BAR</text>
      <circle cx="220" cy="40" r="5" fill="#111"/><text x="175" y="43" class="sec-label">TOP BAR</text>
      <circle cx="220" cy="120" r="5" fill="#111"/><text x="175" y="123" class="sec-label">BOT. BAR</text>
      <line x1="55" y1="45" x2="55" y2="115" stroke="#111" stroke-width="1" stroke-dasharray="4,2"/>
      <line x1="225" y1="45" x2="225" y2="115" stroke="#111" stroke-width="1" stroke-dasharray="4,2"/>
      <text x="110" y="75" class="sec-label">STIRRUP / TIE</text>
      <rect x="50" y="30" width="180" height="100" fill="none" stroke="#111" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="100" y="155" class="sec-dim">TYPICAL SECTION</text>
    </svg>`;
}

function buildTypicalBarArrangementSvg(): string {
  return `
    <svg viewBox="0 0 280 140" class="arrangement-svg" aria-label="Typical bar arrangement">
      <style>
        .arr-label { font: 8px Arial; fill: #111; }
      </style>
      <rect x="20" y="20" width="240" height="100" fill="none" stroke="#111" stroke-width="2"/>
      <circle cx="40" cy="40" r="4" fill="#111"/><text x="48" y="43" class="arr-label">BOT. COR.</text>
      <circle cx="40" cy="100" r="4" fill="#111"/><text x="48" y="103" class="arr-label">BOT. CONT.</text>
      <circle cx="240" cy="40" r="4" fill="#111"/><text x="190" y="43" class="arr-label">BOT. COR.</text>
      <circle cx="240" cy="100" r="4" fill="#111"/><text x="190" y="103" class="arr-label">BOT. CONT.</text>
      <line x1="60" y1="100" x2="220" y2="100" stroke="#111" stroke-width="1.5"/>
      <text x="100" y="70" class="arr-label">@WALL CORNER DETAIL</text>
      <path d="M30 30 L30 110 L250 110 L250 30 Z" fill="none" stroke="#111" stroke-width="1" stroke-dasharray="5,3"/>
      <text x="90" y="135" class="arr-label">TYPICAL BAR ARRANGEMENT</text>
    </svg>`;
}

function buildMeshScheduleHtml(): string {
  return `
    <table class="mini-table mesh-table">
      <thead><tr><th>Location</th><th>Mesh Size</th><th>Sheet Size</th><th class="num">Qty</th><th class="num">Area m²</th></tr></thead>
      <tbody>
        <tr><td colspan="5" class="zone-empty">Per structural drawing</td></tr>
      </tbody>
    </table>`;
}

function buildLapCoverHtml(bars: NormalizedBar[], standard: string): string {
  const sizes = Array.from(new Set(bars.map(b => b.size))).filter(s => s !== "—").sort();
  const lapMultiplier = standard.toLowerCase().includes("aci") ? 40 : 45;

  const lapRows = sizes.map(size => {
    const dia = parseInt(size.replace(/[^0-9]/g, "")) || 10;
    const lap = dia * lapMultiplier;
    return `<tr><td>${escapeHtml(size)}</td><td class="num">${lap} mm</td></tr>`;
  }).join("") || `<tr><td colspan="2">—</td></tr>`;

  return `
    <div class="lap-cover-grid">
      <div>
        <div class="mini-title">LAP SCHEDULE</div>
        <table class="mini-table"><thead><tr><th>Size</th><th class="num">Lap Splice</th></tr></thead><tbody>${lapRows}</tbody></table>
      </div>
      <div>
        <div class="mini-title">COVER DETAILS</div>
        <table class="mini-table">
          <thead><tr><th>Location</th><th class="num">Clearance</th></tr></thead>
          <tbody>
            <tr><td>Top</td><td class="num">40 mm</td></tr>
            <tr><td>Bottom</td><td class="num">75 mm</td></tr>
            <tr><td>Sides</td><td class="num">40 mm</td></tr>
            <tr><td>Earth face</td><td class="num">75 mm</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function buildSegmentSheet(
  segment: SegmentGroup,
  segmentBars: NormalizedBar[],
  sheetIndex: number,
  totalSheets: number,
  continuation: boolean,
  allElements: ShopDrawingElement[],
  params: {
    projectName: string;
    clientName: string;
    standard: string;
    coatingType: string;
    dateStr: string;
    logoDataUri: string;
    options: Required<ShopDrawingOptions>;
    estimateContext: string;
  },
): string {
  const drawingNumber = `${params.options.drawingPrefix}${String(sheetIndex + 1).padStart(2, "0")}`;
  const revInitials = (params.clientName || "RS").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "RS";
  const segTitle = continuation
    ? `${segment.segmentName} (CONT.)`
    : segment.segmentName;

  const totalWt = segmentBars.reduce((s, b) => s + b.weightKg, 0);

  return `
    <section class="sheet">
      <div class="sheet-frame">
        ${buildMetaStripHtml(segmentBars, sheetIndex, totalSheets, params.options.notes, params.estimateContext, params.options.estimateFileName || "")}
        <div class="segment-grid">

          <!-- TOP LEFT: Plan Layout -->
          <div class="zone zone-plan">
            <div class="zone-title">${escapeHtml(segTitle)} — PLAN LAYOUT</div>
            ${buildPlanLayoutSvg(segmentBars, allElements)}
          </div>

          <!-- TOP RIGHT: BBS Table -->
          <div class="zone zone-bbs">
            <div class="zone-title">BAR BENDING SCHEDULE${continuation ? " (CONT.)" : ""}</div>
            ${buildBbsTableHtml(segmentBars, params.options)}
          </div>

          <!-- RIGHT: Shape Keys -->
          <div class="zone zone-shapes">
            <div class="zone-title">SHAPES</div>
            ${buildShapeKeysHtml(segmentBars)}
          </div>

          <!-- MIDDLE LEFT: Section Detail -->
          <div class="zone zone-section">
            <div class="zone-title">TYPICAL SECTION</div>
            ${buildSectionDetailSvg()}
          </div>

          <!-- MIDDLE RIGHT: Mesh + Lap/Cover -->
          <div class="zone zone-mesh-lap">
            <div class="zone-title">MESH SCHEDULE</div>
            ${buildMeshScheduleHtml()}
            ${buildLapCoverHtml(segmentBars, params.standard)}
          </div>

          <!-- BOTTOM LEFT: Typical Bar Arrangement -->
          <div class="zone zone-arrangement">
            <div class="zone-title">TYPICAL BAR ARRANGEMENT</div>
            ${buildTypicalBarArrangementSvg()}
          </div>

          <!-- BOTTOM RIGHT: Revision + Title Block -->
          <div class="zone zone-titleblock">
            <div class="revision-table">
              <div class="mini-title">REVISION RECORD</div>
              <table class="mini-table">
                <thead><tr><th>△</th><th>Description</th><th>Date</th><th>By</th></tr></thead>
                <tbody>
                  <tr><td>△0</td><td>Initial draft for review</td><td>${escapeHtml(params.dateStr)}</td><td>${escapeHtml(revInitials)}</td></tr>
                </tbody>
              </table>
            </div>

            <div class="title-block-content">
              <div class="logo-row">
                ${params.logoDataUri ? `<img src="${params.logoDataUri}" alt="Logo"/>` : ""}
                <div>
                  <div class="company-name">REBAR.SHOP</div>
                  <div class="company-tagline">AN INNOVATIVE METHOD OF FABRICATION</div>
                </div>
              </div>
              <table class="title-block-table">
                <tr><th>Project</th><td>${escapeHtml(params.projectName)}</td></tr>
                <tr><th>Part of Structure</th><td>${escapeHtml(segTitle)}</td></tr>
                <tr><th>Customer</th><td>${escapeHtml(params.clientName || "—")}</td></tr>
                <tr><th>Standard</th><td>${escapeHtml(params.standard)}</td></tr>
                <tr><th>Coating</th><td>${escapeHtml(params.coatingType)}</td></tr>
                <tr><th>Drawing No.</th><td>${escapeHtml(drawingNumber)}</td></tr>
                <tr><th>Bar List No.</th><td>${escapeHtml(drawingNumber)}</td></tr>
                <tr><th>Total Weight</th><td>${formatNumber(totalWt, 1)} kg (${formatNumber(totalWt / 1000, 3)} T)</td></tr>
              </table>
              <div class="title-block-footer">
                <span>Sheet ${sheetIndex + 1} / ${totalSheets}</span>
                <span>${escapeHtml(params.dateStr)}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// ── Main entry point ────────────────────────────────────────

export function buildShopDrawingHtml(params: BuildShopDrawingParams): string {
  const options: Required<ShopDrawingOptions> = {
    scale: params.options?.scale || "1:50",
    includeDims: params.options?.includeDims ?? true,
    layerGrouping: params.options?.layerGrouping ?? true,
    barMarks: params.options?.barMarks ?? true,
    drawingPrefix: params.options?.drawingPrefix || "SD-",
    notes: params.options?.notes || "",
    estimateFileName: params.options?.estimateFileName || "",
  };

  const estimateContext = (params.estimateContext || "").trim();

  const projectName = params.projectName || "Project";
  const clientName = params.clientName || "—";
  const standard = params.standard || "ACI 318 / RSIC";
  const coatingType = params.coatingType || "Black Steel";
  const dateStr = params.dateStr || new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const logoDataUri = params.logoDataUri || "";
  const bars = normalizeBars(params.barList || []);
  const elements = params.elements || [];

  // Group bars by structural segment
  const segments = groupBySegment(bars);
  if (segments.length === 0) {
    segments.push({ segmentName: "GENERAL", bars: [] });
  }

  // Build sheets: one per segment, overflow to continuation sheets
  const sheetDefs: { segment: SegmentGroup; bars: NormalizedBar[]; continuation: boolean }[] = [];
  for (const seg of segments) {
    const chunks = chunkArray(seg.bars, SEGMENT_BBS_LIMIT);
    if (chunks.length === 0) chunks.push([]);
    chunks.forEach((chunk, ci) => {
      sheetDefs.push({ segment: seg, bars: chunk, continuation: ci > 0 });
    });
  }

  const totalSheets = sheetDefs.length;
  const sheetParams = { projectName, clientName, standard, coatingType, dateStr, logoDataUri, options, estimateContext };

  const sheetHtml = sheetDefs.map((def, i) =>
    buildSegmentSheet(def.segment, def.bars, i, totalSheets, def.continuation, elements, sheetParams)
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(projectName)} - Shop Drawing</title>
  <style>
    @page { size: letter landscape; margin: 0.3in; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #111; background: #d1d5db; }
    body { padding: 16px; }

    .sheet {
      width: 10.4in; min-height: 7.9in; margin: 0 auto 18px;
      background: #fff; box-shadow: 0 8px 24px rgba(15,23,42,.18);
      page-break-after: always; break-after: page;
    }
    .sheet:last-child { page-break-after: auto; break-after: auto; }

    .sheet-frame {
      height: 7.9in; border: 2px solid #111; padding: 4px;
      display: flex; flex-direction: column; gap: 3px; min-height: 0;
    }

    .sheet-meta-strip {
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      max-height: 1.35in;
      overflow: hidden;
    }
    .sheet-meta-strip--views-only { grid-template-columns: 1fr; }

    .view-check-wrap { border: 1px solid #111; padding: 3px; overflow: auto; font-size: 6.5px; line-height: 1.25; }
    .view-check-wrap .meta-title { font-size: 7px; margin-bottom: 2px; }
    .meta-grid { display: flex; flex-direction: column; gap: 3px; min-height: 0; overflow: hidden; }
    .meta-block { border: 1px solid #111; padding: 3px; overflow: auto; flex: 1; font-size: 6.5px; }
    .meta-title { font-size: 7px; font-weight: 700; text-transform: uppercase; margin-bottom: 2px; letter-spacing: 0.04em; }
    .meta-body { white-space: pre-wrap; word-break: break-word; }
    .meta-muted { font-size: 6px; color: #555; margin: 2px 0 0; }
    .estimate-pre {
      margin: 0; padding: 2px; font-family: Consolas, monospace; font-size: 6px; white-space: pre-wrap; word-break: break-word;
      max-height: 0.95in; overflow: auto;
    }
    .view-check-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .view-check-table th, .view-check-table td { border: 1px solid #ccc; padding: 1px 2px; font-size: 6px; vertical-align: top; }
    .view-check-table th { background: #f5f5f5; }

    /* 6-zone consolidated grid matching reference SD22 layout */
    .segment-grid {
      display: grid;
      grid-template-columns: 320px 1fr 160px;
      grid-template-rows: minmax(0, 1.1fr) minmax(0, 0.9fr) minmax(0, 0.8fr);
      gap: 3px;
      flex: 1;
      min-height: 0;
    }

    .zone { border: 1px solid #111; padding: 4px; overflow: hidden; }

    .zone-plan     { grid-column: 1; grid-row: 1; }
    .zone-bbs      { grid-column: 2; grid-row: 1 / 3; }
    .zone-shapes   { grid-column: 3; grid-row: 1 / 3; }
    .zone-section  { grid-column: 1; grid-row: 2; }
    .zone-mesh-lap { grid-column: 2; grid-row: 3; }
    .zone-arrangement { grid-column: 1; grid-row: 3; }
    .zone-titleblock  { grid-column: 3; grid-row: 3; display: flex; flex-direction: column; }

    .zone-title {
      font-size: 8px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; margin-bottom: 3px; padding-bottom: 2px;
      border-bottom: 1px solid #999;
    }

    .zone-empty { font-size: 8px; color: #666; padding: 4px; }

    /* BBS Table */
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #111; padding: 2px 3px; font-size: 7.5px; line-height: 1.2; text-align: left; vertical-align: top; }
    th { font-weight: 700; background: #fff; }
    .num { text-align: right; }

    .bbs-table th, .bbs-table td { font-size: 7px; padding: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bbs-table td:last-child, .bbs-table th:last-child { white-space: normal; }
    .total-row td { border-top: 2px solid #111; background: #f5f5f5; }

    .section-row td { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: #f5f5f5; }

    /* Shape keys grid */
    .shape-keys-grid { display: grid; grid-template-columns: 1fr; gap: 3px; }
    .shape-mini-card { border: 1px solid #ccc; padding: 3px; }
    .shape-code-label { font-size: 9px; font-weight: 700; }
    .shape-marks { font-size: 7px; color: #555; }
    .shape-svg { display: block; width: 100%; height: 40px; }
    .shape-svg path, .shape-svg rect { fill: none; stroke: #111; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .shape-svg .dim { stroke-width: 1; }
    .shape-svg text { font-size: 10px; font-family: Arial; }

    /* Plan layout */
    .plan-layout-svg { width: 100%; max-height: 200px; }

    /* Section + arrangement SVGs */
    .section-svg, .arrangement-svg { width: 100%; max-height: 130px; }

    /* Mesh table */
    .mesh-table { margin-bottom: 4px; }

    /* Lap/cover */
    .lap-cover-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    .lap-cover-grid .mini-title { font-size: 7px; font-weight: 700; text-transform: uppercase; margin-bottom: 2px; }

    .mini-title { font-size: 8px; font-weight: 700; text-transform: uppercase; margin-bottom: 3px; letter-spacing: 0.06em; }
    .mini-table th, .mini-table td { font-size: 7px; }

    /* Revision + title block */
    .revision-table { margin-bottom: 4px; }
    .title-block-content { flex: 1; display: flex; flex-direction: column; }

    .logo-row { display: flex; gap: 4px; align-items: center; padding-bottom: 3px; margin-bottom: 3px; border-bottom: 1px solid #111; }
    .logo-row img { width: 28px; height: 28px; object-fit: contain; }
    .company-name { font-size: 11px; font-weight: 700; }
    .company-tagline { font-size: 6px; letter-spacing: 0.06em; text-transform: uppercase; }

    .title-block-table th, .title-block-table td { font-size: 7px; padding: 1px 3px; }
    .title-block-table th { width: 42%; }

    .title-block-footer {
      margin-top: auto; padding-top: 3px; border-top: 1px solid #111;
      font-size: 7px; display: flex; justify-content: space-between;
    }

    @media print {
      html, body { background: #fff; }
      body { padding: 0; }
      .sheet { width: auto; min-height: auto; margin: 0; box-shadow: none; }
      .sheet-frame { height: calc(7.9in - 2px); }
    }
  </style>
</head>
<body>
  ${sheetHtml}
</body>
</html>`;
}
