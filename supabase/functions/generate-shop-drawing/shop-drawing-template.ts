export interface ShopDrawingOptions {
  scale?: string;
  includeDims?: boolean;
  layerGrouping?: boolean;
  barMarks?: boolean;
  drawingPrefix?: string;
  notes?: string;
  /** Optional: uploaded estimate workbook file name (for title block / summary) */
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
  /** Tabular text from optional CSV/XLSX upload */
  estimateContext?: string;
}

interface SheetDefinition {
  title: string;
  subtitle: string;
  mainContent: string;
  referenceContent: string;
}

interface ScheduleEntry {
  kind: "section" | "bar";
  title?: string;
  bar?: NormalizedBar;
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

interface NormalizedElementRegion {
  elementId: string;
  elementType: string;
  pageNumber: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  synthetic?: boolean;
}

interface DrawingViewSpec {
  key:
    | "top_view"
    | "front_elevation"
    | "side_elevation"
    | "horizontal_section"
    | "vertical_section"
    | "section_view"
    | "cross_section"
    | "longitudinal_section"
    | "detail_view"
    | "stirrup_detail"
    | "tie_spiral_detail";
  label: string;
  purpose: string;
  callout: string;
}

interface ViewPolicySelection {
  primaryLabel: string;
  views: DrawingViewSpec[];
  constructabilityNotes: string[];
  flagForReview: boolean;
  reviewReason?: string;
}

const SHEET_ROW_LIMIT = 24;
const SHAPES_PER_SHEET = 6;
const SIZE_TABLE_LIMIT = 12;
const SECTION_INDEX_LIMIT = 14;

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
    "10M": 0.785,
    "15M": 1.57,
    "20M": 2.355,
    "25M": 3.925,
    "30M": 5.495,
    "35M": 7.85,
    "4M": 0.25,
    "5M": 0.395,
    "6M": 0.56,
    "#3": 0.56,
    "#4": 0.994,
    "#5": 1.552,
    "#6": 2.235,
    "#7": 3.042,
    "#8": 3.973,
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
        qty,
        multiplier,
        pieces,
        lengthMm,
        totalLengthM,
        weightKg,
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

function buildElementTypesViewChecklistHtml(bars: NormalizedBar[]): string {
  const types = Array.from(new Set(bars.map((b) => b.elementType).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (types.length === 0) {
    return `<p class="note-list compact">No element types in bar list.</p>`;
  }
  const rows = types
    .map((t) => `<tr><td>${escapeHtml(t)}</td><td>${escapeHtml(requiredViewsForElementType(t).join(" · "))}</td></tr>`)
    .join("");
  return `
    <div class="mini-title">Minimum graphic views by element type</div>
    <table class="mini-table">
      <tr><th>Type</th><th>Required views (add details when ambiguous)</th></tr>
      ${rows}
    </table>
    <p class="note-list compact">Schedules supplement views; they do not replace them. Every bar mark should appear in schedule and at least one graphic view.</p>`;
}

const ESTIMATE_CONTEXT_MAX = 7000;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getElementBBox(element: ShopDrawingElement): number[] | null {
  const bbox = element.bbox || element.regions?.tag_region?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [x1, y1, x2, y2] = bbox.map((value) => toNumber(value));
  if (x2 <= x1 || y2 <= y1) return null;
  return [x1, y1, x2, y2];
}

function normalizeElementRegions(
  elements: ShopDrawingElement[],
  bars: NormalizedBar[],
): NormalizedElementRegion[] {
  const directRegions: NormalizedElementRegion[] = elements
    .map((element): NormalizedElementRegion | null => {
      const bbox = getElementBBox(element);
      if (!bbox) return null;

      return {
        elementId: String(element.element_id || "ELEMENT").trim() || "ELEMENT",
        elementType: String(element.element_type || "OTHER").trim() || "OTHER",
        pageNumber: Math.max(1, Math.round(toNumber(element.page_number || element.regions?.tag_region?.page_number) || 1)),
        x1: bbox[0],
        y1: bbox[1],
        x2: bbox[2],
        y2: bbox[3],
        synthetic: false,
      };
    })
    .filter((region): region is NonNullable<typeof region> => region !== null);

  if (directRegions.length > 0) {
    return directRegions.sort((a, b) => {
      if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
      if (a.y1 !== b.y1) return a.y1 - b.y1;
      return a.x1 - b.x1;
    });
  }

  const syntheticElements = Array.from(
    bars.reduce((acc, bar) => {
      const key = `${bar.elementId}|||${bar.elementType}`;
      if (!acc.has(key)) {
        acc.set(key, { elementId: bar.elementId, elementType: bar.elementType });
      }
      return acc;
    }, new Map<string, { elementId: string; elementType: string }>())
      .values()
  );

  return syntheticElements.map((element, index) => {
    const pageIndex = Math.floor(index / 8);
    const position = index % 8;
    const col = position % 4;
    const row = Math.floor(position / 4);
    const x1 = 50 + col * 180;
    const y1 = 48 + row * 128;
    return {
      elementId: element.elementId,
      elementType: element.elementType,
      pageNumber: pageIndex + 1,
      x1,
      y1,
      x2: x1 + 130,
      y2: y1 + 82,
      synthetic: true,
    };
  });
}

function getBarsForRegion(region: NormalizedElementRegion, bars: NormalizedBar[]): NormalizedBar[] {
  const directMatches = bars.filter((bar) => bar.elementId === region.elementId);
  if (directMatches.length > 0) return directMatches;
  return bars.filter((bar) => bar.elementType === region.elementType);
}

function buildStandardReferencePanels(standard: string, coatingType: string): string {
  const slabLapRows = [
    ["10M", '17"'],
    ["15M", '25"'],
    ["20M", '33"'],
    ["25M", '51"'],
    ["30M", '61"'],
    ["35M", '71"'],
  ];
  const wallLapRows = [
    ["10M", '20"'],
    ["15M", '30"'],
    ["20M", '39"'],
    ["25M", '61"'],
    ["30M", '72"'],
    ["35M", '84"'],
  ];

  const slabLapTable = slabLapRows.map(([size, splice]) => `
    <tr><td>${size}</td><td class="num">${splice}</td></tr>
  `).join("");
  const wallLapTable = wallLapRows.map(([size, splice]) => `
    <tr><td>${size}</td><td class="num">${splice}</td></tr>
  `).join("");

  return `
    <div class="standards-grid">
      <section class="reference-panel compact">
        <div class="mini-title">Lap schedule - structural slab</div>
        <table class="mini-table">
          <tr><th>Size</th><th class="num">35 MPA</th></tr>
          ${slabLapTable}
        </table>
      </section>
      <section class="reference-panel compact">
        <div class="mini-title">Lap schedule - concrete walls</div>
        <table class="mini-table">
          <tr><th>Size</th><th class="num">25 MPA</th></tr>
          ${wallLapTable}
        </table>
      </section>
      <section class="reference-panel compact">
        <div class="mini-title">Cover details</div>
        <table class="mini-table">
          <tr><th>Ground floor slab</th><td>Top 1 1/2" clr, sides 3" clr</td></tr>
          <tr><th>Footing</th><td>Bottom 3" clr, faces 1 1/2" clr</td></tr>
          <tr><th>Walls</th><td>Top / bottom / sides 1 1/2" clr</td></tr>
          <tr><th>Grade beam</th><td>Top 1 1/2" clr, bottom 3" clr</td></tr>
        </table>
      </section>
      <section class="reference-panel compact">
        <div class="mini-title">General notes</div>
        <table class="mini-table">
          <tr><th>Standard</th><td>${escapeHtml(standard)}</td></tr>
          <tr><th>Coating</th><td>${escapeHtml(coatingType)}</td></tr>
          <tr><th>Use</th><td>Verify dimensions and bar arrangement against latest engineer-issued drawing.</td></tr>
          <tr><th>Issue</th><td>Draft shop drawing for review and field coordination.</td></tr>
        </table>
      </section>
    </div>
  `;
}

function buildReferenceContent(primaryContent: string, standard: string, coatingType: string): string {
  return `
    <div class="reference-shell">
      <div class="reference-primary">
        ${primaryContent}
      </div>
      ${buildStandardReferencePanels(standard, coatingType)}
    </div>
  `;
}

function buildLayoutViewport(regions: NormalizedElementRegion[]): string {
  if (regions.length === 0) {
    return `<div class="layout-empty">No element geometry was available, so the layout sheet shows schedule-based details only.</div>`;
  }

  const minX = Math.min(...regions.map((region) => region.x1));
  const minY = Math.min(...regions.map((region) => region.y1));
  const maxX = Math.max(...regions.map((region) => region.x2));
  const maxY = Math.max(...regions.map((region) => region.y2));
  const sourceWidth = Math.max(maxX - minX, 1);
  const sourceHeight = Math.max(maxY - minY, 1);
  const width = 760;
  const height = 320;
  const pad = 30;
  const scale = Math.min((width - pad * 2) / sourceWidth, (height - pad * 2) / sourceHeight);

  const items = regions.map((region, index) => {
    const x = pad + (region.x1 - minX) * scale;
    const y = pad + (region.y1 - minY) * scale;
    const w = Math.max(46, (region.x2 - region.x1) * scale);
    const h = Math.max(32, (region.y2 - region.y1) * scale);
    const bubbleX = x + 14;
    const bubbleY = y + 14;
    const labelY = y + Math.min(h / 2 + 4, h - 8);
    return `
      <g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" ry="3" />
        <circle cx="${bubbleX.toFixed(1)}" cy="${bubbleY.toFixed(1)}" r="10" />
        <text x="${bubbleX.toFixed(1)}" y="${(bubbleY + 3.5).toFixed(1)}" text-anchor="middle">${index + 1}</text>
        <text x="${(x + w / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" class="layout-label">${escapeHtml(region.elementId)}</text>
      </g>
    `;
  }).join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="layout-svg" aria-hidden="true">
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" class="layout-outline" />
      ${items}
    </svg>
  `;
}

function normalizeElementClass(elementType: string): string {
  const normalized = elementType.trim().toUpperCase();
  if (/PILE_CAP/.test(normalized)) return "pile_cap";
  if (/FOOTING|PAD|MAT/.test(normalized)) return "footing";
  if (/WALL/.test(normalized)) return "wall";
  if (/SLAB|RAFT/.test(normalized)) return "slab";
  if (/GRADE_BEAM/.test(normalized)) return "grade_beam";
  if (/BEAM/.test(normalized)) return "beam";
  if (/COLUMN/.test(normalized)) return "column";
  if (/PIER/.test(normalized)) return "pier";
  if (/STAIR|RAMP/.test(normalized)) return "stair";
  return "other";
}

function hasComplexReinforcementSignals(bars: NormalizedBar[]): boolean {
  if (bars.length === 0) return false;

  const notesBlob = bars
    .flatMap((bar) => [bar.note, bar.shapeCode, bar.barMark, bar.subgroup])
    .join(" ")
    .toUpperCase();

  return (
    /\b(OPENING|PENETRATION|LAP|SPLICE|HOOK|ANCHOR|DOWEL|EMBED|CORNER|CONGEST|OFFSET|STEP|SLOPE|THICKEN|DROP|JOINT|VARIABLE|INTERSECTION|JAMB)\b/.test(notesBlob) ||
    bars.some((bar) => bar.shapeCode !== "STRAIGHT" && bar.shapeCode !== "CLOSED") ||
    bars.some((bar) => [bar.legA, bar.legB, bar.legC, bar.legD].some((value) => Boolean(value))) ||
    bars.length >= 5
  );
}

function createViewSpec(
  key: DrawingViewSpec["key"],
  label: string,
  purpose: string,
  index: number,
): DrawingViewSpec {
  const suffix = String.fromCharCode(65 + index);
  return {
    key,
    label,
    purpose,
    callout: `${suffix}${index + 1}`,
  };
}

function getConstructabilityNotes(elementClass: string, bars: NormalizedBar[]): string[] {
  const notes = [
    "Every bar mark shown here must also appear in the schedule and at least one graphic view.",
  ];

  if (elementClass === "footing" || elementClass === "pile_cap" || elementClass === "slab") {
    notes.push("Show chairs, standees, or support bars needed to maintain top and bottom cover.");
  }
  if (elementClass === "wall") {
    notes.push("Identify inside/outside faces and maintain spacer support so bars remain on the correct face.");
  }
  if (elementClass === "beam" || elementClass === "grade_beam") {
    notes.push("Keep longitudinal bars, stirrups, and end anchorage details tied to the same beam reference.");
  }
  if (elementClass === "column" || elementClass === "pier") {
    notes.push("Confirm tie or spiral spacing and clearly mark lap/splice zones before placing.");
  }
  if (elementClass === "stair") {
    notes.push("Coordinate bar bends and supports with stair geometry before fabrication.");
  }
  if (bars.some((bar) => /\bCHAIR|STANDEE|SUPPORT|TIE\b/i.test(bar.note))) {
    notes.push("Support and tying notes from the bar list must remain visible on the placing views.");
  }

  return notes;
}

function selectViewsForElement(region: NormalizedElementRegion, bars: NormalizedBar[]): ViewPolicySelection {
  const elementClass = normalizeElementClass(region.elementType);
  const complex = hasComplexReinforcementSignals(bars);
  const views: DrawingViewSpec[] = [];

  const pushView = (key: DrawingViewSpec["key"], label: string, purpose: string) => {
    views.push(createViewSpec(key, label, purpose, views.length));
  };

  switch (elementClass) {
    case "footing":
    case "pile_cap":
      pushView("top_view", "Top view", "Primary orthographic view for bar layout, spacing, and bar mark locations.");
      pushView("section_view", "Section A-A", "Clarifies cover, top/bottom layers, and hook orientation through the footing depth.");
      if (complex) pushView("detail_view", "Detail 1", "Enlarged view for stepped edges, dowels, or congested reinforcement zones.");
      break;
    case "wall":
      pushView("front_elevation", "Front elevation", "Primary view for vertical bar arrangement, openings, and elevation dimensions.");
      pushView("horizontal_section", "Horizontal section", "Shows face-of-placement, wall thickness, and horizontal bar position.");
      pushView("vertical_section", "Vertical section", "Shows lap zones, cover, and top/bottom anchorage through the wall height.");
      if (complex) pushView("detail_view", "Detail 1", "Enlarged corner/opening/embed view to remove ambiguity around laps or dowels.");
      break;
    case "slab":
      pushView("top_view", "Top view", "Primary view for bar layout, spacing, openings, and thickened edges.");
      pushView("section_view", "Section A-A", "Shows top/bottom mat layering, cover, and drop or thickened slab depth.");
      if (complex) pushView("detail_view", "Detail 1", "Enlarged opening, penetration, or edge reinforcement detail.");
      break;
    case "beam":
    case "grade_beam":
      pushView("front_elevation", "Longitudinal elevation", "Primary view for longitudinal bars, bar curtailment, and bar marks along the span.");
      pushView("cross_section", "Section A-A", "Shows stirrups, cover, and layer arrangement through the beam width and depth.");
      if (complex) pushView("detail_view", "Detail 1", "End anchorage or congestion detail for hooks, laps, or support conditions.");
      break;
    case "column":
    case "pier":
      pushView("front_elevation", "Front elevation", "Primary view for vertical reinforcement and lap/splice zoning.");
      pushView("cross_section", "Cross-section", "Shows bar count, tie spacing, and cover around the perimeter.");
      pushView("tie_spiral_detail", "Tie / spiral detail", "Clarifies tie, hoop, or spiral arrangement where confinement is critical.");
      if (complex) pushView("detail_view", "Detail 1", "Enlarged lap or connection detail at splice or embed zones.");
      break;
    case "stair":
      pushView("top_view", "Plan view", "Primary view for stair or ramp bar layout and directional placement.");
      pushView("longitudinal_section", "Longitudinal section", "Shows rise/run geometry and bar continuity through the slope.");
      pushView("cross_section", "Cross-section", "Clarifies cover, face of placement, and bar layering across width.");
      pushView("detail_view", "Detail 1", "Enlarged bend and anchorage detail at landings, nosings, or supports.");
      break;
    default:
      pushView("top_view", "Primary view", "Primary orthographic view showing bar placement for this element.");
      pushView("section_view", "Section A-A", "Adds cover and layer information where the primary view is insufficient.");
      if (complex) pushView("detail_view", "Detail 1", "Enlarged local view where geometry or bar orientation remains ambiguous.");
      break;
  }

  const flagForReview = !!(region.synthetic && (complex || views.length > 1));
  const reviewReason = flagForReview
    ? "Source geometry was incomplete, so these view frames were inferred from bar data. Verify dimensions and orientation before issue."
    : undefined;

  return {
    primaryLabel: views[0]?.label || "Primary view",
    views,
    constructabilityNotes: getConstructabilityNotes(elementClass, bars),
    flagForReview,
    reviewReason,
  };
}

function buildViewBlocks(region: NormalizedElementRegion, bars: NormalizedBar[], selection: ViewPolicySelection): string {
  const markList = bars.slice(0, 4).map((bar) => bar.barMark).join(", ") || "No mapped marks";

  return selection.views.map((view) => `
    <article class="view-card">
      <div class="view-card-head">
        <span class="view-callout">${escapeHtml(view.callout)}</span>
        <div>
          <div class="view-card-title">${escapeHtml(view.label)}</div>
          <div class="view-card-subtitle">${escapeHtml(region.elementId)} / ${escapeHtml(region.elementType)}</div>
        </div>
      </div>
      <div class="view-diagram">
        <div class="view-diagram-label">${escapeHtml(view.label)}</div>
      </div>
      <p class="view-purpose">${escapeHtml(view.purpose)}</p>
      <p class="view-bar-marks"><strong>Bar marks:</strong> ${escapeHtml(markList)}</p>
    </article>
  `).join("");
}

function buildElementDetailCard(
  region: NormalizedElementRegion,
  bars: NormalizedBar[],
  index: number,
): string {
  const detailRows = bars.slice(0, 5).map((bar) => `
    <tr>
      <td>${escapeHtml(bar.barMark)}</td>
      <td>${escapeHtml(bar.size)}</td>
      <td class="num">${formatNumber(bar.pieces)}</td>
      <td>${bar.note ? escapeHtml(bar.note) : escapeHtml(bar.shapeCode)}</td>
    </tr>
  `).join("");

  const detailKind = /WALL|COLUMN|PIER/.test(region.elementType)
    ? "Elevation detail"
    : /FOOTING|SLAB|RAFT|BEAM/.test(region.elementType)
    ? "Plan detail"
    : "Reinforcement detail";
  const selection = selectViewsForElement(region, bars);
  const viewBlocks = buildViewBlocks(region, bars, selection);
  const constructabilityNotes = selection.constructabilityNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");

  return `
    <article class="detail-card">
      <div class="detail-card-head">
        <div class="detail-index">${index + 1}</div>
        <div>
          <div class="detail-card-title">${escapeHtml(region.elementId)} - ${escapeHtml(region.elementType)}</div>
          <div class="detail-card-subtitle">${detailKind} / ${escapeHtml(selection.primaryLabel)}</div>
        </div>
      </div>
      ${selection.flagForReview ? `<div class="detail-flag">FLAG FOR REVIEW: ${escapeHtml(selection.reviewReason)}</div>` : ""}
      <div class="view-grid">
        ${viewBlocks}
      </div>
      <table class="mini-table detail-table">
        <tr><th>Bar Mark</th><th>Size</th><th class="num">Pcs</th><th>Description</th></tr>
        ${detailRows || `<tr><td colspan="4">No related bars found.</td></tr>`}
      </table>
      <div class="detail-note-title">Constructability notes</div>
      <ul class="note-list compact">
        ${constructabilityNotes}
      </ul>
    </article>
  `;
}

function buildLayoutSheets(params: {
  bars: NormalizedBar[];
  elements: ShopDrawingElement[];
  projectName: string;
  clientName: string;
  standard: string;
  coatingType: string;
}): SheetDefinition[] {
  const regions = normalizeElementRegions(params.elements, params.bars);
  const byPage = regions.reduce((acc, region) => {
    if (!acc.has(region.pageNumber)) acc.set(region.pageNumber, []);
    acc.get(region.pageNumber)?.push(region);
    return acc;
  }, new Map<number, NormalizedElementRegion[]>());

  const pageEntries = Array.from(byPage.entries()).sort((a, b) => a[0] - b[0]);
  if (pageEntries.length === 0) return [];

  return pageEntries.flatMap(([pageNumber, pageRegions], pageIndex) =>
    chunkArray(pageRegions, 8).map((regionChunk, chunkIndex) => {
      const dominantTypes = Array.from(
        regionChunk.reduce((acc, region) => {
          acc.set(region.elementType, (acc.get(region.elementType) || 0) + 1);
          return acc;
        }, new Map<string, number>())
      ).sort((a, b) => b[1] - a[1]);
      const dominantType = dominantTypes[0]?.[0] || "FOUNDATION";
      const title = `${params.projectName} ${dominantType.toLowerCase()} reinforcement layout`;
      const subtitle = `Plan, elevation, and section callouts - source page ${pageNumber}${chunkIndex > 0 ? ` / part ${chunkIndex + 1}` : ""}`;

      const detailCards = regionChunk.map((region, index) =>
        buildElementDetailCard(region, getBarsForRegion(region, params.bars), index)
      ).join("");

      const relatedBars = regionChunk.flatMap((region) => getBarsForRegion(region, params.bars));
      const primaryReference = `
        <section class="reference-panel compact">
          <div class="mini-title">Sheet summary</div>
          <table class="mini-table">
            <tr><th>Source page</th><td>${pageNumber}</td></tr>
            <tr><th>Elements shown</th><td class="num">${formatNumber(regionChunk.length)}</td></tr>
            <tr><th>Bar items linked</th><td class="num">${formatNumber(relatedBars.length)}</td></tr>
            <tr><th>Part of structure</th><td>${escapeHtml(dominantType)}</td></tr>
          </table>
        </section>
      `;

      return {
        title: pageIndex === 0 && chunkIndex === 0 ? "Foundation plan and reinforcement details" : `Reinforcement details ${pageIndex + 1}.${chunkIndex + 1}`,
        subtitle,
        mainContent: `
          <div class="drawing-header compact">
            <div>
              <div class="drawing-kicker">PLAN LAYOUT / REINFORCEMENT DETAILS</div>
              <h1>${escapeHtml(title)}</h1>
              <p>This sheet uses element-type view selection so each callout gets the plan, elevation, section, and detail views needed to define reinforcement without relying on the schedule alone.</p>
            </div>
            <div class="summary-badge small">
              <strong>${formatNumber(regionChunk.length)}</strong>
              <span>Callouts on sheet</span>
            </div>
          </div>
          <div class="layout-main">
            <section class="layout-panel">
              <div class="panel-title">Plan layout</div>
              ${buildLayoutViewport(regionChunk)}
            </section>
            <div class="detail-grid">
              ${detailCards || `<div class="layout-empty">No detail cards available.</div>`}
            </div>
          </div>
        `,
        referenceContent: buildReferenceContent(primaryReference, params.standard, params.coatingType),
      };
    })
  );
}

function buildShapeSvg(shapeCode: string): string {
  switch (shapeCode) {
    case "17":
      return `
        <svg viewBox="0 0 180 100" class="shape-svg" aria-hidden="true">
          <path d="M30 75 L30 25 L140 25" />
          <path class="dim" d="M18 75 L18 25 M18 25 L30 25 M18 75 L30 75" />
          <path class="dim" d="M30 12 L140 12 M30 12 L30 25 M140 12 L140 25" />
          <text x="10" y="52">A</text>
          <text x="82" y="8">B</text>
        </svg>`;
    case "31":
      return `
        <svg viewBox="0 0 180 100" class="shape-svg" aria-hidden="true">
          <path d="M28 72 L70 72 L112 28 L152 28" />
          <path class="dim" d="M28 84 L70 84 M28 84 L28 72 M70 84 L70 72" />
          <path class="dim" d="M112 16 L152 16 M112 16 L112 28 M152 16 L152 28" />
          <text x="44" y="96">A</text>
          <text x="126" y="12">B</text>
          <text x="78" y="58">C</text>
        </svg>`;
    case "T1":
      return `
        <svg viewBox="0 0 180 100" class="shape-svg" aria-hidden="true">
          <path d="M38 72 L38 28 L142 28 L142 72" />
          <path class="dim" d="M24 72 L24 28 M24 28 L38 28 M24 72 L38 72" />
          <path class="dim" d="M38 14 L142 14 M38 14 L38 28 M142 14 L142 28" />
          <path class="dim" d="M156 28 L156 72 M142 28 L156 28 M142 72 L156 72" />
          <text x="14" y="53">A</text>
          <text x="86" y="10">B</text>
          <text x="160" y="53">C</text>
        </svg>`;
    case "T12":
      return `
        <svg viewBox="0 0 180 100" class="shape-svg" aria-hidden="true">
          <path d="M26 66 L126 66 Q148 66 148 44 L148 24" />
          <path class="dim" d="M26 80 L126 80 M26 80 L26 66 M126 80 L126 66" />
          <path class="dim" d="M162 24 L162 44 M148 24 L162 24 M148 44 L162 44" />
          <text x="70" y="94">Length</text>
          <text x="166" y="36">A</text>
        </svg>`;
    case "2":
      return `
        <svg viewBox="0 0 180 100" class="shape-svg" aria-hidden="true">
          <path d="M28 68 L124 68 Q146 68 146 46 L146 32" />
          <path class="dim" d="M28 82 L124 82 M28 82 L28 68 M124 82 L124 68" />
          <text x="70" y="94">Length</text>
          <text x="126" y="24">Hook B optional</text>
        </svg>`;
    case "CLOSED":
      return `
        <svg viewBox="0 0 180 100" class="shape-svg" aria-hidden="true">
          <rect x="38" y="24" width="104" height="48" />
          <path class="dim" d="M24 72 L24 24 M24 24 L38 24 M24 72 L38 72" />
          <path class="dim" d="M38 12 L142 12 M38 12 L38 24 M142 12 L142 24" />
          <text x="14" y="52">A</text>
          <text x="86" y="8">B</text>
        </svg>`;
    case "STRAIGHT":
    default:
      return `
        <svg viewBox="0 0 180 100" class="shape-svg" aria-hidden="true">
          <path d="M26 50 L154 50" />
          <path class="dim" d="M26 36 L154 36 M26 36 L26 50 M154 36 L154 50" />
          <text x="78" y="28">Length</text>
        </svg>`;
  }
}

function createSummarySheet(params: {
  projectName: string;
  clientName: string;
  standard: string;
  coatingType: string;
  options: Required<ShopDrawingOptions>;
  dateStr: string;
  sizeBreakdown: Record<string, number>;
  bars: NormalizedBar[];
  elements: ShopDrawingElement[];
  scheduleSheetCount: number;
  shapeSheetCount: number;
  estimateContext?: string;
  estimateFileName?: string;
}): SheetDefinition {
  const totalWeightKg = params.bars.reduce((sum, bar) => sum + bar.weightKg, 0);
  const totalLengthM = params.bars.reduce((sum, bar) => sum + bar.totalLengthM, 0);
  const totalPieces = params.bars.reduce((sum, bar) => sum + bar.pieces, 0);
  const bentBarCount = params.bars.filter((bar) => bar.shapeCode !== "STRAIGHT").length;

  const sizeEntries = Object.entries(params.sizeBreakdown || {})
    .map(([size, weight]) => [size, toNumber(weight)] as const)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" }));

  if (sizeEntries.length === 0) {
    const computed: Record<string, number> = {};
    for (const bar of params.bars) {
      computed[bar.size] = (computed[bar.size] || 0) + bar.weightKg;
    }
    sizeEntries.push(
      ...Object.entries(computed).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" }))
    );
  }

  const sectionIndex = Array.from(
    new Set(params.bars.map((bar) => `${bar.elementType}${bar.subgroup ? ` - ${bar.subgroup}` : ` - ${bar.elementId}`}`))
  ).slice(0, SECTION_INDEX_LIMIT);

  const pageStats = Array.from(
    params.elements.reduce((acc, element) => {
      const pageNumber = element.page_number || element.regions?.tag_region?.page_number;
      if (!pageNumber) return acc;
      acc.set(pageNumber, (acc.get(pageNumber) || 0) + 1);
      return acc;
    }, new Map<number, number>())
  )
    .sort((a, b) => a[0] - b[0])
    .slice(0, 8);

  const sizeRows = sizeEntries.slice(0, SIZE_TABLE_LIMIT).map(([size, weight]) => `
    <tr>
      <td>${escapeHtml(size)}</td>
      <td class="num">${formatNumber(weight, 1)}</td>
    </tr>
  `).join("");

  const sectionRows = sectionIndex.map((section, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(section)}</td>
    </tr>
  `).join("");

  const pageRows = pageStats.length > 0
    ? pageStats.map(([page, count]) => `
        <tr>
          <td>Source page ${page}</td>
          <td class="num">${count}</td>
        </tr>
      `).join("")
    : `
      <tr>
        <td>Element pages</td>
        <td class="num">N/A</td>
      </tr>
    `;

  const mainContent = `
    <div class="drawing-header">
      <div>
        <div class="drawing-kicker">SHOP DRAWING DRAFT SET</div>
        <h1>${escapeHtml(params.projectName)}</h1>
        <p>Structured multi-sheet draft generated from the validated bar list. Large projects are broken into readable schedule sheets instead of being compressed onto one page.</p>
      </div>
      <div class="summary-badge">
        <strong>${params.scheduleSheetCount + params.shapeSheetCount + 1}</strong>
        <span>Total sheets</span>
      </div>
    </div>

    <div class="summary-grid">
      <div class="metric-card">
        <span>Total bars</span>
        <strong>${formatNumber(params.bars.length)}</strong>
      </div>
      <div class="metric-card">
        <span>Total pieces</span>
        <strong>${formatNumber(totalPieces)}</strong>
      </div>
      <div class="metric-card">
        <span>Total cut length</span>
        <strong>${formatNumber(totalLengthM, 1)} m</strong>
      </div>
      <div class="metric-card">
        <span>Total weight</span>
        <strong>${formatNumber(totalWeightKg, 1)} kg</strong>
      </div>
      <div class="metric-card">
        <span>Bar sections</span>
        <strong>${formatNumber(sectionIndex.length)}</strong>
      </div>
      <div class="metric-card">
        <span>Bent bars</span>
        <strong>${formatNumber(bentBarCount)}</strong>
      </div>
    </div>

    <div class="panel-grid">
      <section class="panel">
        <div class="panel-title">Project and issue data</div>
        <table class="meta-table">
          <tr><th>Customer</th><td>${escapeHtml(params.clientName || "—")}</td></tr>
          <tr><th>Standard</th><td>${escapeHtml(params.standard)}</td></tr>
          <tr><th>Product line</th><td>${escapeHtml(params.coatingType)}</td></tr>
          <tr><th>Scale</th><td>${escapeHtml(params.options.scale)}</td></tr>
          <tr><th>Date</th><td>${escapeHtml(params.dateStr)}</td></tr>
          <tr><th>Notes</th><td>${escapeHtml(params.options.notes || "Verify dimensions against IFC and latest plan before fabrication.")}</td></tr>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">Sheet contents</div>
        <table class="meta-table">
          <tr><th>Summary sheet</th><td>1</td></tr>
          <tr><th>Bar schedule sheets</th><td>${params.scheduleSheetCount}</td></tr>
          <tr><th>Shape key sheets</th><td>${params.shapeSheetCount}</td></tr>
          <tr><th>Dimensions shown</th><td>${params.options.includeDims ? "Where source data exists" : "Suppressed by option"}</td></tr>
          <tr><th>Layer grouping</th><td>${params.options.layerGrouping ? "By element and subgroup" : "Flat bar list ordering"}</td></tr>
          <tr><th>Bar marks</th><td>${params.options.barMarks ? "Visible" : "Suppressed"}</td></tr>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">Source drawing coverage</div>
        <table class="meta-table">
          <tr><th>Measure</th><th class="num">Value</th></tr>
          ${pageRows}
        </table>
      </section>
    </div>

    <section class="panel estimate-panel">
      <div class="panel-title">Placing views checklist</div>
      ${buildElementTypesViewChecklistHtml(params.bars)}
      ${(() => {
        const raw = (params.estimateContext || "").trim();
        const fn = params.estimateFileName || "";
        if (!raw && !fn) return "";
        const capped = raw.length > ESTIMATE_CONTEXT_MAX ? `${raw.slice(0, ESTIMATE_CONTEXT_MAX)}\n… [truncated]` : raw;
        return `
          <div class="mini-title" style="margin-top:8px">Estimate upload${fn ? ` — ${escapeHtml(fn)}` : ""}</div>
          ${capped ? `<pre class="estimate-pre">${escapeHtml(capped)}</pre>` : `<p class="note-list compact">No tabular text parsed (file name only).</p>`}
        `;
      })()}
    </section>
  `;

  const referenceContent = `
    <div class="reference-grid">
      <section class="reference-panel">
        <div class="mini-title">Bar size schedule</div>
        <table class="mini-table">
          <tr><th>Size</th><th class="num">Kg</th></tr>
          ${sizeRows || `<tr><td colspan="2">No size data</td></tr>`}
        </table>
      </section>
      <section class="reference-panel">
        <div class="mini-title">Section index</div>
        <table class="mini-table">
          <tr><th>No.</th><th>Section</th></tr>
          ${sectionRows || `<tr><td colspan="2">No sections</td></tr>`}
        </table>
      </section>
      <section class="reference-panel">
        <div class="mini-title">Drafting notes</div>
        <ul class="note-list">
          <li>This draft is split across multiple sheets to keep tables readable.</li>
          <li>Cut lengths are taken from the imported bar list.</li>
          <li>Shape dimensions A-D are shown only when supplied in source data.</li>
          <li>Review field conditions and the latest structural drawing before fabrication.</li>
        </ul>
      </section>
    </div>
  `;

  return {
    title: "General arrangement and summary",
    subtitle: "Sheet index, project data, and fabrication summary",
    mainContent,
    referenceContent,
  };
}

function buildScheduleSheets(
  bars: NormalizedBar[],
  options: Required<ShopDrawingOptions>,
): SheetDefinition[] {
  const grouped = new Map<string, NormalizedBar[]>();
  for (const bar of bars) {
    const subgroup = options.layerGrouping ? (bar.subgroup || bar.elementId) : bar.elementId;
    const key = `${bar.elementType}|||${subgroup}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push(bar);
  }

  const entriesPerPage: ScheduleEntry[][] = [];
  let currentPage: ScheduleEntry[] = [];
  let usedRows = 0;

  for (const [key, groupBars] of grouped.entries()) {
    const [elementType, subgroup] = key.split("|||");
    const titleBase = `${elementType}${subgroup ? ` - ${subgroup}` : ""}`;
    let index = 0;

    while (index < groupBars.length) {
      if (usedRows > 0 && SHEET_ROW_LIMIT - usedRows < 2) {
        entriesPerPage.push(currentPage);
        currentPage = [];
        usedRows = 0;
      }

      currentPage.push({
        kind: "section",
        title: index === 0 ? titleBase : `${titleBase} (cont.)`,
      });
      usedRows += 1;

      while (index < groupBars.length && usedRows < SHEET_ROW_LIMIT) {
        currentPage.push({ kind: "bar", bar: groupBars[index] });
        index += 1;
        usedRows += 1;
      }

      if (index < groupBars.length) {
        entriesPerPage.push(currentPage);
        currentPage = [];
        usedRows = 0;
      }
    }
  }

  if (currentPage.length > 0) {
    entriesPerPage.push(currentPage);
  }

  if (entriesPerPage.length === 0) {
    entriesPerPage.push([]);
  }

  return entriesPerPage.map((entries, pageIndex) => {
    const rows = entries.map((entry) => {
      if (entry.kind === "section") {
        return `<tr class="section-row"><td colspan="13">${escapeHtml(entry.title)}</td></tr>`;
      }

      const bar = entry.bar!;
      return `
        <tr>
          <td>${escapeHtml(options.barMarks ? bar.barMark : bar.elementId)}</td>
          <td>${escapeHtml(bar.size)}</td>
          <td>${escapeHtml(bar.shapeCode)}</td>
          <td class="num">${formatNumber(bar.pieces)}</td>
          <td class="num">${bar.lengthMm > 0 ? formatNumber(bar.lengthMm) : "—"}</td>
          <td class="num">${options.includeDims && bar.legA ? formatNumber(bar.legA) : "—"}</td>
          <td class="num">${options.includeDims && bar.legB ? formatNumber(bar.legB) : "—"}</td>
          <td class="num">${options.includeDims && bar.legC ? formatNumber(bar.legC) : "—"}</td>
          <td class="num">${options.includeDims && bar.legD ? formatNumber(bar.legD) : "—"}</td>
          <td class="num">—</td>
          <td class="num">—</td>
          <td class="num">${bar.weightKg > 0 ? formatNumber(bar.weightKg, 1) : "—"}</td>
          <td>${escapeHtml(bar.note || "—")}</td>
        </tr>
      `;
    }).join("");

    const pageBars = entries
      .filter((entry): entry is { kind: "bar"; bar: NormalizedBar } => entry.kind === "bar")
      .map((entry) => entry.bar);

    const pageWeight = pageBars.reduce((sum, bar) => sum + bar.weightKg, 0);
    const pageLength = pageBars.reduce((sum, bar) => sum + bar.totalLengthM, 0);

    const referenceContent = `
      <div class="reference-grid">
        <section class="reference-panel">
          <div class="mini-title">Page summary</div>
          <table class="mini-table">
            <tr><th>Rows</th><td class="num">${formatNumber(pageBars.length)}</td></tr>
            <tr><th>Total length</th><td class="num">${formatNumber(pageLength, 1)} m</td></tr>
            <tr><th>Total weight</th><td class="num">${formatNumber(pageWeight, 1)} kg</td></tr>
            <tr><th>Units</th><td>mm / m / kg</td></tr>
          </table>
        </section>
        <section class="reference-panel">
          <div class="mini-title">Column legend</div>
          <table class="mini-table">
            <tr><th>A-D</th><td>Leg dimensions when supplied</td></tr>
            <tr><th>Pieces</th><td>Qty x multiplier</td></tr>
            <tr><th>Cut mm</th><td>Single bar cut length</td></tr>
            <tr><th>Total m</th><td>Total cut length for listed pieces</td></tr>
          </table>
        </section>
        <section class="reference-panel">
          <div class="mini-title">Fabrication notes</div>
          <ul class="note-list">
            <li>Bars are grouped by element type and subgroup for readability.</li>
            <li>Continuation headers are added when a section spans multiple sheets.</li>
            <li>Any missing A-D dimensions must be verified from the source drawing.</li>
          </ul>
        </section>
      </div>
    `;

    return {
      title: `Bar bending schedule ${pageIndex + 1}`,
      subtitle: "Readable paginated schedule for fabrication and review",
      mainContent: `
        <div class="drawing-header compact">
          <div>
            <div class="drawing-kicker">BAR BENDING SCHEDULE</div>
            <h1>Grouped by element and bar section</h1>
            <p>Large projects are split across multiple sheets so table text remains legible when printed to PDF.</p>
          </div>
          <div class="summary-badge small">
            <strong>${formatNumber(pageBars.length)}</strong>
            <span>Bar rows on sheet</span>
          </div>
        </div>

        <table class="bbs-table">
          <thead>
            <tr>
              <th>MARK</th>
              <th>SIZE</th>
              <th>TYPE</th>
              <th class="num">NO.</th>
              <th class="num">LENGTH</th>
              <th class="num">A</th>
              <th class="num">B</th>
              <th class="num">C</th>
              <th class="num">D</th>
              <th class="num">E</th>
              <th class="num">R</th>
              <th class="num">WEIGHT</th>
              <th>REMARKS</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="13">No bar list data available.</td></tr>`}
          </tbody>
        </table>
      `,
      referenceContent,
    };
  });
}

function buildShapeSheets(bars: NormalizedBar[]): SheetDefinition[] {
  const shapes = Array.from(
    bars.reduce((acc, bar) => {
      if (!acc.has(bar.shapeCode)) {
        acc.set(bar.shapeCode, []);
      }
      acc.get(bar.shapeCode)?.push(bar);
      return acc;
    }, new Map<string, NormalizedBar[]>())
  )
    .sort((a, b) => {
      if (a[0] === "STRAIGHT") return -1;
      if (b[0] === "STRAIGHT") return 1;
      return a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" });
    });

  return chunkArray(shapes, SHAPES_PER_SHEET).map((shapeChunk, pageIndex) => {
    const shapeCards = shapeChunk.map(([shapeCode, shapeBars]) => {
      const sampleMarks = shapeBars.slice(0, 4).map((bar) => bar.barMark).join(", ");
      const typicalCut = shapeBars.reduce((sum, bar) => sum + bar.lengthMm, 0) / Math.max(shapeBars.length, 1);
      return `
        <article class="shape-card">
          <div class="shape-card-header">
            <div>
              <div class="shape-code">${escapeHtml(shapeCode)}</div>
              <p>${shapeBars.length} bar item${shapeBars.length === 1 ? "" : "s"}</p>
            </div>
            <div class="shape-length">${typicalCut > 0 ? `${formatNumber(typicalCut)} mm typ.` : "Cut length varies"}</div>
          </div>
          ${buildShapeSvg(shapeCode)}
          <div class="shape-note">
            <strong>Sample marks:</strong> ${escapeHtml(sampleMarks || "N/A")}
          </div>
        </article>
      `;
    }).join("");

    const referenceContent = `
      <div class="reference-grid">
        <section class="reference-panel">
          <div class="mini-title">Shape note</div>
          <ul class="note-list">
            <li>Diagrams are schematic and intended to organize the schedule.</li>
            <li>Use the cut length and source drawing for fabrication control.</li>
            <li>Unknown shape codes are shown with a generic bar sketch.</li>
          </ul>
        </section>
        <section class="reference-panel">
          <div class="mini-title">Typical dimensions</div>
          <table class="mini-table">
            <tr><th>A-D</th><td>Leg labels only when supplied in source data</td></tr>
            <tr><th>Length</th><td>Overall cut length from bar list</td></tr>
            <tr><th>Use</th><td>Shape key and review support</td></tr>
          </table>
        </section>
        <section class="reference-panel">
          <div class="mini-title">Control</div>
          <table class="mini-table">
            <tr><th>Count</th><td class="num">${formatNumber(shapeChunk.length)}</td></tr>
            <tr><th>Sheet type</th><td>Shape key</td></tr>
            <tr><th>Print size</th><td>Letter landscape</td></tr>
          </table>
        </section>
      </div>
    `;

    return {
      title: `Shape key ${pageIndex + 1}`,
      subtitle: "Typical bend families referenced by the bar schedule",
      mainContent: `
        <div class="drawing-header compact">
          <div>
            <div class="drawing-kicker">SHAPE KEY</div>
            <h1>Typical bend families on this project</h1>
            <p>The previous one-page layout was replaced with dedicated shape sheets so details remain clean and readable.</p>
          </div>
          <div class="summary-badge small">
            <strong>${formatNumber(shapeChunk.length)}</strong>
            <span>Shape families</span>
          </div>
        </div>
        <div class="shape-grid">
          ${shapeCards}
        </div>
      `,
      referenceContent,
    };
  });
}

function buildSheetHtml(
  sheet: SheetDefinition,
  index: number,
  total: number,
  params: Required<Omit<BuildShopDrawingParams, "barList" | "elements" | "sizeBreakdown" | "options">> & {
    options: Required<ShopDrawingOptions>;
    clientName: string;
    standard: string;
    coatingType: string;
    logoDataUri: string;
  },
): string {
  const revisionInitials = (params.clientName || "RS").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "RS";
  const drawingNumber = `${params.options.drawingPrefix}${String(index + 1).padStart(2, "0")}`;
  const projectNumber = `${params.options.drawingPrefix.replace(/-+$/, "") || "SD"}-${String(total).padStart(2, "0")}`;
  const partOfStructure = sheet.title.replace(/\s+\d+(?:\.\d+)?$/, "");

  return `
    <section class="sheet">
      <div class="sheet-frame">
        <div class="sheet-grid">
          <main class="main-area">
            <div class="sheet-heading">
              <div>
                <div class="sheet-title">${escapeHtml(sheet.title)}</div>
                <div class="sheet-subtitle">${escapeHtml(sheet.subtitle)}</div>
              </div>
              <div class="sheet-counter">${escapeHtml(drawingNumber)}<span>${index + 1} of ${total}</span></div>
            </div>
            ${sheet.mainContent}
          </main>

          <aside class="revision-area">
            <div class="mini-title">Revision and issue record</div>
            <table class="mini-table">
              <tr><th>Issue</th><th>Remarks</th><th>Date</th><th>By</th></tr>
              <tr><td><span class="rev-mark"><svg viewBox="0 0 10 10" aria-hidden="true"><polygon points="5,1 9,9 1,9"/></svg>A</span></td><td>FOR APPROVAL</td><td>${escapeHtml(params.dateStr)}</td><td>${escapeHtml(revisionInitials)}</td></tr>
              <tr><td><span class="rev-mark"><svg viewBox="0 0 10 10" aria-hidden="true"><polygon points="5,1 9,9 1,9"/></svg>B</span></td><td>AS PER A/E COMMENTS</td><td>${escapeHtml(params.dateStr)}</td><td>RS</td></tr>
              <tr><td><span class="rev-mark"><svg viewBox="0 0 10 10" aria-hidden="true"><polygon points="5,1 9,9 1,9"/></svg>C</span></td><td>AS PER NEW DRAWING</td><td>${escapeHtml(params.dateStr)}</td><td>RS</td></tr>
            </table>
          </aside>

          <section class="reference-area">
            ${sheet.referenceContent}
          </section>

          <section class="title-block">
            <div class="logo-row">
              ${params.logoDataUri ? `<img src="${params.logoDataUri}" alt="REBAR.SHOP logo" />` : ""}
              <div>
                <div class="company-name">REBAR.SHOP</div>
                <div class="company-tagline">AN INNOVATIVE METHOD OF FABRICATION</div>
                <div class="company-address">Professional Rebar Detailing &amp; Fabrication</div>
              </div>
            </div>

            <table class="title-block-table">
              <tr><th>PROJECT</th><td>${escapeHtml(params.projectName)}</td></tr>
              <tr><th>CUSTOMER</th><td>${escapeHtml(params.clientName || "—")}</td></tr>
              <tr><th>PART OF STRUCTURE</th><td>${escapeHtml(partOfStructure)}</td></tr>
              <tr><th>Project no.</th><td>${escapeHtml(projectNumber)}</td></tr>
              <tr><th>Date</th><td>${escapeHtml(params.dateStr)}</td></tr>
              <tr><th>Standard</th><td>${escapeHtml(params.standard)}</td></tr>
              <tr><th>Coating</th><td>${escapeHtml(params.coatingType)}</td></tr>
              <tr><th>SCALE</th><td>${escapeHtml(params.options.scale)}</td></tr>
              <tr><th>Drawing No.</th><td>${escapeHtml(drawingNumber)}</td></tr>
              <tr><th>BAR LIST No.</th><td>${escapeHtml(drawingNumber)}</td></tr>
              <tr><th>Status</th><td>FOR FIELD USE / REVIEW</td></tr>
            </table>

            <div class="title-block-footer">
              <div><strong>Detailed by:</strong> REBAR.SHOP</div>
              <div><strong>Checked by:</strong> —</div>
            </div>
            <div class="eor-note">E.O.R. ALL REBAR ON THIS DWG IS 400/R</div>
          </section>
        </div>
      </div>
    </section>
  `;
}

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
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const logoDataUri = params.logoDataUri || "";
  const bars = normalizeBars(params.barList || []);
  const elements = params.elements || [];

  const layoutSheets = buildLayoutSheets({
    bars,
    elements,
    projectName,
    clientName,
    standard,
    coatingType,
  });
  const scheduleSheets = buildScheduleSheets(bars, options);
  const shapeSheets = buildShapeSheets(bars.length > 0 ? bars : [{
    elementId: "N/A",
    elementType: "OTHER",
    subgroup: "",
    barMark: "BM-1",
    size: "—",
    shapeCode: "STRAIGHT",
    qty: 1,
    multiplier: 1,
    pieces: 1,
    lengthMm: 0,
    totalLengthM: 0,
    weightKg: 0,
    note: "",
  }]);

  const summarySheet = createSummarySheet({
    projectName,
    clientName,
    standard,
    coatingType,
    options,
    dateStr,
    sizeBreakdown: params.sizeBreakdown || {},
    bars,
    elements,
    scheduleSheetCount: layoutSheets.length + scheduleSheets.length,
    shapeSheetCount: shapeSheets.length,
    estimateContext,
    estimateFileName: options.estimateFileName || undefined,
  });

  const sheets = [summarySheet, ...layoutSheets, ...scheduleSheets, ...shapeSheets];

  const sheetHtml = sheets.map((sheet, index) => buildSheetHtml(sheet, index, sheets.length, {
    projectName,
    clientName,
    standard,
    coatingType,
    dateStr,
    logoDataUri,
    estimateContext: estimateContext || "",
    options,
  })).join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(projectName)} - Shop Drawing Draft</title>
        <style>
          @page {
            size: 17in 11in;
            margin: 0;
          }

          * {
            box-sizing: border-box;
          }

          html, body {
            margin: 0;
            padding: 0;
            font-family: "RomanS", Consolas, "Courier New", monospace;
            color: #000;
            background: #d1d5db;
          }

          body {
            padding: 16px;
          }

          .sheet {
            width: 17in;
            min-height: 11in;
            margin: 0 auto 18px;
            background: #fff;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
            page-break-after: always;
            break-after: page;
            padding: 0.4in;
          }

          .sheet:last-child {
            page-break-after: auto;
            break-after: auto;
          }

          .sheet-frame {
            height: 10.2in;
            border: 2pt solid #000;
            outline: 1pt solid #000;
            outline-offset: 4px;
            padding: 6px;
          }

          .sheet-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 2.2in;
            grid-template-rows: minmax(0, 1fr) 2.0in;
            grid-template-areas:
              "main  title"
              "ref   title"
              "rev   title";
            gap: 6px;
            height: 100%;
          }

          .main-area  { grid-area: main; }
          .reference-area { grid-area: ref; }
          .revision-area  { grid-area: rev; }
          .title-block    { grid-area: title; }

          .main-area,
          .revision-area,
          .reference-area,
          .title-block {
            border: 1pt solid #000;
            overflow: hidden;
          }

          .main-area {
            background-color: #fff;
            background-image:
              radial-gradient(circle, #d8d8d8 0.5px, transparent 0.5px);
            background-size: 0.5in 0.5in;
            background-position: 0 0;
          }

          .main-area {
            padding: 10px;
          }

          .revision-area {
            padding: 8px;
          }

          .reference-area {
            padding: 8px;
          }

          .title-block {
            padding: 8px;
            border-width: 2px;
          }

          .sheet-heading,
          .drawing-header {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: flex-start;
          }

          .sheet-heading {
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid #111;
          }

          .sheet-title {
            font-size: 18px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }

          .sheet-subtitle {
            margin-top: 2px;
            font-size: 10px;
          }

          .sheet-counter,
          .drawing-kicker {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .drawing-header {
            margin-bottom: 12px;
          }

          .drawing-header h1 {
            margin: 3px 0 4px;
            font-size: 17px;
            line-height: 1.2;
          }

          .drawing-header p {
            margin: 0;
            font-size: 10px;
            line-height: 1.45;
            max-width: 520px;
          }

          .drawing-header.compact h1 {
            font-size: 15px;
          }

          .summary-badge {
            min-width: 82px;
            padding: 8px 10px;
            border: 1px solid #111;
            text-align: center;
          }

          .summary-badge strong {
            display: block;
            font-size: 24px;
            line-height: 1;
          }

          .summary-badge span {
            display: block;
            margin-top: 4px;
            font-size: 9px;
            text-transform: uppercase;
          }

          .summary-badge.small strong {
            font-size: 20px;
          }

          .summary-grid {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 8px;
            margin-bottom: 12px;
          }

          .metric-card {
            border: 1px solid #111;
            padding: 8px;
            min-height: 58px;
          }

          .metric-card span {
            display: block;
            font-size: 9px;
            text-transform: uppercase;
          }

          .metric-card strong {
            display: block;
            margin-top: 5px;
            font-size: 18px;
          }

          .panel-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
          }

          .estimate-panel {
            margin-top: 10px;
            border: 1px solid #111;
            padding: 8px;
          }

          .estimate-pre {
            margin: 6px 0 0;
            padding: 6px;
            font-family: Consolas, "Courier New", monospace;
            font-size: 7.5px;
            line-height: 1.3;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 220px;
            overflow: auto;
            border: 1px solid #ccc;
            background: #fafafa;
          }

          .panel,
          .reference-panel {
            border: 1px solid #111;
            padding: 8px;
          }

          .panel-title,
          .mini-title {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            margin-bottom: 6px;
            letter-spacing: 0.06em;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          th,
          td {
            border: 1px solid #111;
            padding: 4px 5px;
            vertical-align: top;
            font-size: 9px;
            line-height: 1.25;
            text-align: left;
          }

          th {
            font-weight: 700;
            background: #fff;
          }

          .num {
            text-align: right;
          }

          .meta-table th {
            width: 34%;
          }

          .reference-grid {
            display: grid;
            grid-template-columns: 1.1fr 1.2fr 1fr;
            gap: 8px;
            height: 100%;
          }

          .mini-table th,
          .mini-table td,
          .meta-table th,
          .meta-table td {
            font-size: 8.5px;
          }

          .note-list {
            margin: 0;
            padding-left: 16px;
            font-size: 8.5px;
            line-height: 1.35;
          }

          .note-list.compact {
            font-size: 8px;
            margin-top: 6px;
          }

          .note-list li + li {
            margin-top: 4px;
          }

          .reference-shell {
            display: flex;
            flex-direction: column;
            gap: 8px;
            height: 100%;
          }

          .reference-primary {
            flex: 0 0 auto;
          }

          .standards-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }

          .reference-panel.compact .mini-table th,
          .reference-panel.compact .mini-table td {
            font-size: 8px;
          }

          .layout-main {
            display: grid;
            grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
            gap: 10px;
            align-items: start;
          }

          .layout-panel,
          .detail-card {
            border: 1px solid #111;
            padding: 8px;
          }

          .layout-svg {
            width: 100%;
            height: auto;
            display: block;
          }

          .layout-outline,
          .layout-svg rect,
          .layout-svg circle {
            fill: none;
            stroke: #111;
            stroke-width: 1.5;
          }

          .layout-svg text {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 10px;
            fill: #111;
          }

          .layout-label {
            font-size: 8px;
          }

          .detail-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }

          .detail-card {
            min-height: 100%;
          }

          .detail-card-head,
          .view-card-head {
            display: flex;
            gap: 8px;
            align-items: flex-start;
          }

          .detail-index,
          .view-callout {
            width: 22px;
            height: 22px;
            border: 1px solid #111;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 9px;
            font-weight: 700;
            flex: 0 0 auto;
          }

          .detail-card-title,
          .view-card-title {
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            line-height: 1.25;
          }

          .detail-card-subtitle,
          .view-card-subtitle {
            font-size: 8px;
            margin-top: 2px;
            line-height: 1.3;
          }

          .detail-flag {
            margin-top: 6px;
            padding: 6px 7px;
            border: 1px solid #111;
            font-size: 8px;
            font-weight: 700;
          }

          .view-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px;
            margin: 8px 0;
          }

          .view-card {
            border: 1px solid #111;
            padding: 6px;
          }

          .view-diagram {
            margin: 6px 0;
            height: 42px;
            border: 1px solid #111;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 4px;
          }

          .view-diagram-label,
          .view-purpose,
          .view-bar-marks,
          .detail-note-title {
            font-size: 8px;
            line-height: 1.35;
          }

          .view-purpose,
          .view-bar-marks {
            margin: 4px 0 0;
          }

          .detail-note-title {
            margin-top: 8px;
            font-weight: 700;
            text-transform: uppercase;
          }

          .detail-table {
            margin-top: 4px;
          }

          .detail-table th,
          .detail-table td {
            font-size: 7.8px;
          }

          .layout-empty {
            min-height: 48px;
            border: 1px dashed #111;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 8px;
            font-size: 8px;
            line-height: 1.35;
          }

          .bbs-table {
            font-family: Consolas, "Courier New", monospace;
          }

          .bbs-table th,
          .bbs-table td {
            font-size: 8px;
            padding: 3px 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            border: 0.5pt solid #000;
          }

          .bbs-table th {
            background: #f0f0f0;
            font-weight: 700;
            letter-spacing: 0.04em;
          }

          .bbs-table td:last-child,
          .bbs-table th:last-child {
            white-space: normal;
          }

          .section-row td {
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            background: #f5f5f5;
          }

          .shape-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .shape-card {
            border: 1px solid #111;
            padding: 8px;
            min-height: 148px;
          }

          .shape-card-header {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
          }

          .shape-code {
            font-size: 14px;
            font-weight: 700;
          }

          .shape-card p,
          .shape-length,
          .shape-note {
            margin: 0;
            font-size: 9px;
            line-height: 1.35;
          }

          .shape-svg {
            display: block;
            width: 100%;
            height: 78px;
            margin: 6px 0;
          }

          .shape-svg path,
          .shape-svg rect {
            fill: none;
            stroke: #111;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }

          .shape-svg .dim {
            stroke-width: 1;
          }

          .shape-svg text {
            font-size: 10px;
            font-family: Arial, Helvetica, sans-serif;
          }

          .logo-row {
            display: flex;
            gap: 8px;
            align-items: center;
            padding-bottom: 8px;
            margin-bottom: 8px;
            border-bottom: 1px solid #111;
          }

          .logo-row img {
            max-width: 110px;
            max-height: 44px;
            width: auto;
            height: auto;
            object-fit: contain;
          }

          .rev-mark {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            font-weight: 700;
          }

          .rev-mark svg {
            width: 8px;
            height: 8px;
            fill: none;
            stroke: #111;
            stroke-width: 1.2;
          }

          .company-name {
            font-size: 16px;
            font-weight: 700;
          }

          .company-tagline {
            font-size: 8px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
          }

          .title-block-table th,
          .title-block-table td {
            font-size: 8.5px;
          }

          .title-block-table th {
            width: 38%;
          }

          .title-block-footer {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #111;
            font-size: 8.5px;
            line-height: 1.5;
          }


          .company-address {
            font-size: 7px;
            color: #444;
            margin-top: 1px;
          }

          .eor-note {
            margin-top: 6px;
            padding: 3px 6px;
            border: 1.5px solid #111;
            font-size: 8px;
            font-weight: 700;
            text-align: center;
            letter-spacing: 0.04em;
          }

          @media print {
            html, body {
              background: #fff;
            }

            body {
              padding: 0;
            }

            .sheet {
              width: auto;
              min-height: auto;
              margin: 0;
              box-shadow: none;
              padding: 0.4in;
            }

            .sheet-frame {
              height: calc(10.2in - 2px);
            }
          }
        </style>
      </head>
      <body>
        ${sheetHtml}
      </body>
    </html>
  `;
}
