import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================================
// Deterministic structural graph + geometry resolver
// ----------------------------------------------------------------------------
// Geometry-first rebar: instead of asking the AI to compute lengths, we ask
// the AI to extract callouts, then we resolve them against a graph built from
// the structural OCR (footing schedules, wall elevations, lap defaults, bar
// shapes). Rows that cannot be resolved are persisted with
// assumptions_json.geometry_status = 'unresolved' and confidence 0 so the UI
// can render "—" + a red badge instead of a misleading zero.
// ============================================================================

const REBAR_DIA_MM: Record<string, number> = {
  "10M": 11.3, "15M": 16.0, "20M": 19.5, "25M": 25.2, "30M": 29.9, "35M": 35.7,
  "#3": 9.5,  "#4": 12.7,  "#5": 15.9,  "#6": 19.1,  "#7": 22.2,  "#8": 25.4,
};
const REBAR_MASS_KG_PER_M: Record<string, number> = {
  "10M": 0.785, "15M": 1.570, "20M": 2.355, "25M": 3.925, "30M": 5.495, "35M": 7.850,
  "45M": 11.775, "55M": 19.625,
  "#3": 0.561, "#4": 0.994, "#5": 1.552, "#6": 2.235, "#7": 3.042, "#8": 3.973,
  "#9": 5.060, "#10": 6.404, "#11": 7.907, "#14": 11.384, "#18": 20.238,
};
const WWM_MASS_KG_PER_M2: Record<string, number> = {
  "6X6-W1.4/W1.4": 0.93, "6X6-W2.1/W2.1": 1.37, "6X6-W2.9/W2.9": 1.90,
  "6X6-W4.0/W4.0": 2.63, "4X4-W2.1/W2.1": 2.05, "4X4-W4.0/W4.0": 3.94,
};
const sizeKey = (s: string) => {
  const k = String(s || "").toUpperCase().trim();
  const m = k.match(/^(10M|15M|20M|25M|30M|35M|45M|55M|#1[0148]|#[3-9])/);
  return m ? m[1] : k;
};
const massFor = (size: string, type: string): number => {
  const k = String(size || "").toUpperCase().trim();
  if (type === "wwm") return WWM_MASS_KG_PER_M2[k] || 0;
  return REBAR_MASS_KG_PER_M[sizeKey(k)] || 0;
};

// Parse WWM coverage area (m²) from a description like
// "6X6-W2.9/W2.9 - 250 m2", "WWM 4X4 ... 1,200 sqft", "MESH 85 SF".
// Returns 0 when nothing usable is present so callers can flag UNRESOLVED.
function parseWwmAreaM2(text: string): number {
  const t = String(text || "").toUpperCase().replace(/,/g, "");
  const m2 = t.match(/(\d+(?:\.\d+)?)\s*(?:M\^?2|M²|SQ\s*M|SQM)/);
  if (m2) return Number(m2[1]);
  const sf = t.match(/(\d+(?:\.\d+)?)\s*(?:SF|SQ\s*FT|SQFT|FT\^?2|FT²)/);
  if (sf) return Number(sf[1]) * 0.092903;
  return 0;
}

// RSIC stock length (m). Bars longer than this need splices.
// Default ≈60 ft = 18.288 m. Configurable via standards_profile.naming_rules.stock_length_m.
function pickStockLengthM(naming: any): number {
  const v = Number(naming?.stock_length_m);
  return v && v > 0 ? v : 18.288;
}

// Add lap splices when a single bar exceeds stock length.
// barLenM = developed bar length per piece; lapMm = lap-splice length per joint.
function applySpliceWaste(barLenM: number, lapMm: number, stockM: number): { lenM: number; splices: number } {
  if (!(barLenM > 0) || !(stockM > 0) || barLenM <= stockM) return { lenM: barLenM, splices: 0 };
  const splices = Math.ceil(barLenM / stockM) - 1;
  return { lenM: +(barLenM + splices * (Math.max(0, lapMm) / 1000)).toFixed(3), splices };
}

// RSIC standard hook addition (mm) by bar size.
// 90° hook ≈ 12·db, 180° hook ≈ 6·db + 4·db tail. db taken from sizeKey.
function dbMmFor(sizeKey0: string): number {
  const k = sizeKey0.toUpperCase();
  const map: Record<string, number> = {
    "10M":11.3,"15M":16,"20M":19.5,"25M":25.2,"30M":29.9,"35M":35.7,"45M":43.7,"55M":56.4,
    "#3":9.5,"#4":12.7,"#5":15.9,"#6":19.1,"#7":22.2,"#8":25.4,"#9":28.7,"#10":32.3,"#11":35.8,"#14":43,"#18":57.3,
  };
  return map[k] || 0;
}
function hookAddMm(sizeKey0: string, descUpper: string): number {
  const db = dbMmFor(sizeKey0);
  if (!db) return 0;
  const has180 = /\b180(?:\s*°|DEG)?\b|\bSTD\s*HK\b/.test(descUpper);
  const has135 = /\b135(?:\s*°|DEG)?\b/.test(descUpper);
  const has90 = /\b90(?:\s*°|DEG)?\b|\bHOOK\b|\bHK\b/.test(descUpper);
  if (has180) return Math.round(10 * db);
  if (has135) return Math.round(8 * db);
  if (has90) return Math.round(12 * db);
  return 0;
}
// NOTE: hardcoded lap fallback (e.g. 40·db) removed by policy.
// Lap lengths must come from Manual-Standard-Practice-2018 (via Brain) or
// from an explicit LAP table in the structural OCR. If neither source
// provides a value, the line is marked UNRESOLVED.

// Build a lightweight structural graph from STRUCTURAL OCR pages only.
// Architectural OCR is intentionally excluded as a geometry source.
interface StructuralGraph {
  // Bar marks the OCR explicitly defines, e.g. "BS80" or "B2035"
  barMarks: Map<string, { size?: string; shape?: string; raw: string }>;
  // Wall callouts: "WALL ... 12500MM ... 3000MM HIGH"
  walls: Array<{ id?: string; lengthMm?: number; heightMm?: number; raw: string }>;
  // Footing schedule rows: "F1 ... 2400 X 600 ... 2-15M T&B"
  footings: Array<{ id?: string; lengthMm?: number; widthMm?: number; raw: string }>;
  // Lap table overrides keyed by size: { "15M": 800 }
  lapTable: Map<string, number>;
  // Detailer's verify notes
  verifyNotes: string[];
}

interface WallGeometryPage {
  pageNumber: number;
  sheetTag?: string | null;
  rawText: string;
  discipline?: string | null;
  scaleRaw?: string | null;
  scaleRatio?: number | null;
  bbox?: [number, number, number, number] | null;
}

interface WallGeometryEvidence {
  lengthMm: number | null;
  heightMm: number | null;
  method: "explicit_text" | "schedule" | "scale_measurement" | "not_found";
  confidence: "high" | "medium" | "low";
  needsConfirmation: boolean;
  pageNumber?: number | null;
  sheetTag?: string | null;
  excerpt?: string | null;
  scaleRaw?: string | null;
  reason: string;
}

interface LinearElementGeometryEvidence {
  objectLabel: string | null;
  lengthMm: number | null;
  heightMm: number | null;
  barCallout: string | null;
  spacingMm: number | null;
  orientation: "vertical" | "horizontal" | "unknown";
  method: "explicit_text" | "schedule" | "scale_measurement" | "not_found";
  confidence: "high" | "medium" | "low";
  needsConfirmation: boolean;
  pageNumber?: number | null;
  sheetTag?: string | null;
  excerpt?: string | null;
  scaleRaw?: string | null;
  reason: string;
}

function buildStructuralGraph(structuralText: string): StructuralGraph {
  const g: StructuralGraph = {
    barMarks: new Map(),
    walls: [],
    footings: [],
    lapTable: new Map(),
    verifyNotes: [],
  };
  if (!structuralText) return g;
  const text = structuralText.toUpperCase();

  // Bar marks: BS\d{2,3} or B\d{4} optionally followed by size token
  const markRx = /\b(B[S]?\d{2,4})\b[^\n]{0,80}?(10M|15M|20M|25M|30M|35M|#[3-8])?/g;
  let mm: RegExpExecArray | null;
  while ((mm = markRx.exec(text))) {
    const id = mm[1];
    if (g.barMarks.has(id)) continue;
    g.barMarks.set(id, { size: mm[2], raw: mm[0].slice(0, 100) });
  }

  // Wall dimensions
  const wallRx = /WALL[^\n]{0,80}?(\d{3,5})\s*MM[^\n]{0,40}?(?:HIGH|HEIGHT|HGT)?[^\n]{0,20}?(\d{3,5})?\s*MM?/g;
  let wm: RegExpExecArray | null;
  while ((wm = wallRx.exec(text))) {
    const a = Number(wm[1]); const b = wm[2] ? Number(wm[2]) : undefined;
    // Heuristic: longer is length, shorter is height
    const lengthMm = b && b > a ? b : a;
    const heightMm = b && b > a ? a : b;
    g.walls.push({ lengthMm, heightMm, raw: wm[0].slice(0, 80) });
    if (g.walls.length >= 8) break;
  }

  // Footing schedule: "F1 2400 X 600" or "F12 1200x1200"
  const ftgRx = /\b(F\d{1,3})\b[^\n]{0,40}?(\d{3,5})\s*[X×]\s*(\d{3,5})/g;
  let fm: RegExpExecArray | null;
  while ((fm = ftgRx.exec(text))) {
    g.footings.push({ id: fm[1], lengthMm: Number(fm[2]), widthMm: Number(fm[3]), raw: fm[0].slice(0, 80) });
    if (g.footings.length >= 16) break;
  }

  // Lap table: "LAP 15M = 800" or "15M LAP 800MM"
  const lapRx = /(10M|15M|20M|25M|30M|35M|#[3-8])[^\n]{0,20}?LAP[^\n]{0,10}?(\d{3,4})/g;
  const lapRx2 = /LAP[^\n]{0,10}?(10M|15M|20M|25M|30M|35M|#[3-8])[^\n]{0,10}?(\d{3,4})/g;
  for (const rx of [lapRx, lapRx2]) {
    let lm: RegExpExecArray | null;
    while ((lm = rx.exec(text))) g.lapTable.set(sizeKey(lm[1]), Number(lm[2]));
  }

  // Detailer verify notes
  const verifyRx = /(?:PLEASE\s+)?(?:ENG\.?\s+)?VERIFY[^\n]{0,80}/g;
  let vm: RegExpExecArray | null;
  while ((vm = verifyRx.exec(text))) {
    g.verifyNotes.push(vm[0].trim());
    if (g.verifyNotes.length >= 12) break;
  }
  return g;
}

function parseScaleRatio(scaleRaw: string | null | undefined): number | null {
  const raw = String(scaleRaw || "").trim();
  const ratio = raw.match(/1\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (ratio) return Number(ratio[1]);
  const metric = raw.match(/(\d+(?:\.\d+)?)\s*mm\s*=\s*(\d+(?:\.\d+)?)\s*m/i);
  if (metric) return (Number(metric[2]) * 1000) / Number(metric[1]);
  return null;
}

function resolveWallGeometryFromPages(params: {
  pages: WallGeometryPage[];
  objectText?: string | null;
  calloutText?: string | null;
  sourceSheet?: string | null;
}): WallGeometryEvidence {
  const candidates = params.pages
    .filter((page) => isStructuralWallPage(page))
    .map((page) => ({ page, score: scoreWallPage(page, params) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { page } of candidates) {
    const explicit = extractExplicitWallGeometry(page.rawText);
    if (explicit.lengthMm || explicit.heightMm) {
      return {
        ...explicit,
        method: explicit.method || "explicit_text",
        confidence: explicit.lengthMm && explicit.heightMm ? "high" : "medium",
        needsConfirmation: !(explicit.lengthMm && explicit.heightMm),
        pageNumber: page.pageNumber,
        sheetTag: page.sheetTag,
        scaleRaw: page.scaleRaw,
        reason: explicit.lengthMm && explicit.heightMm ? "Found explicit wall dimensions in OCR text." : "Found partial wall dimensions in OCR text.",
      };
    }
  }

  for (const { page } of candidates) {
    const scale = page.scaleRatio || parseScaleRatio(page.scaleRaw);
    const measured = measureWallFromBbox(page.bbox, scale);
    if (measured) {
      return {
        lengthMm: measured,
        heightMm: null,
        method: "scale_measurement",
        confidence: "low",
        needsConfirmation: true,
        pageNumber: page.pageNumber,
        sheetTag: page.sheetTag,
        scaleRaw: page.scaleRaw,
        excerpt: wallSnippet(page.rawText),
        reason: "Estimated wall run from bbox and sheet scale; wall height still needs confirmation.",
      };
    }
  }

  return {
    lengthMm: null,
    heightMm: null,
    method: "not_found",
    confidence: "low",
    needsConfirmation: true,
    reason: candidates.length > 1
      ? "Multiple wall candidates were found, but none had provable dimensions."
      : "No reliable wall dimensions were found across structural pages.",
  };
}

function isScaleMeasurableLinearElement(text: string | null | undefined): boolean {
  return /\b(brick\s+ledge|ledge|curb|slab\s+edge|pad|foundation\s+wall|frost\s+wall|wall)\b/i.test(String(text || ""));
}

function inferLinearObject(text: string): string | null {
  const t = text.toLowerCase();
  if (/brick\s+ledge/.test(t)) return "brick ledge";
  if (/\bcurb\b/.test(t)) return "curb";
  if (/slab\s+edge/.test(t)) return "slab edge";
  if (/foundation\s+wall|frost\s+wall|\bwall\b/.test(t)) return "foundation wall";
  if (/\bpad\b/.test(t)) return "pad";
  if (/\bledge\b/.test(t)) return "ledge";
  return null;
}

function extractLinearBarCallout(text: string): Pick<LinearElementGeometryEvidence, "barCallout" | "spacingMm" | "orientation"> {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const verbose = normalized.match(/\b(10M|15M|20M|25M|30M|35M)\s+(?:(vertical|horizontal)\s+)?bars?\s*@\s*(\d+(?:\.\d+)?)\s*mm\s*(?:\([^)]*\)\s*)?O\.?\s*C\.?(?:\s*(typical|staggered))?/i);
  if (verbose) {
    const orientation = verbose[2]?.toLowerCase() === "vertical" || verbose[2]?.toLowerCase() === "horizontal"
      ? verbose[2].toLowerCase() as "vertical" | "horizontal"
      : "unknown";
    return {
      barCallout: [verbose[1].toUpperCase(), orientation !== "unknown" ? orientation : null, "bars @", `${Number(verbose[3])}mm`, "O.C.", verbose[4]?.toLowerCase()].filter(Boolean).join(" "),
      spacingMm: Number(verbose[3]),
      orientation,
    };
  }
  const compact = normalized.match(/\b(10M|15M|20M|25M|30M|35M)\s*@\s*(\d+(?:\.\d+)?)\s*mm\s*(?:\([^)]*\)\s*)?O\.?\s*C\.?(?:\s*(vertical|horizontal|typical|staggered))?/i);
  if (!compact) return { barCallout: null, spacingMm: null, orientation: "unknown" };
  const tail = compact[3]?.toLowerCase() || "";
  return {
    barCallout: [compact[1].toUpperCase(), "@", `${Number(compact[2])}mm`, "O.C.", tail || null].filter(Boolean).join(" "),
    spacingMm: Number(compact[2]),
    orientation: tail === "vertical" || tail === "horizontal" ? tail : "unknown",
  };
}

function scoreLinearPage(page: WallGeometryPage, params: { objectText?: string | null; calloutText?: string | null; sourceSheet?: string | null }, objectLabel: string | null) {
  const text = page.rawText.toLowerCase();
  let score = 0;
  if (objectLabel && text.includes(objectLabel)) score += 4;
  if (params.sourceSheet && String(page.sheetTag || "").toLowerCase().includes(String(params.sourceSheet).toLowerCase())) score += 2;
  for (const token of distinctiveTokens(`${params.objectText || ""} ${params.calloutText || ""}`)) {
    if (text.includes(token)) score += 1;
  }
  if (isScaleMeasurableLinearElement(text)) score += 1;
  return score;
}

function extractLinearDimensions(text: string, objectLabel: string | null) {
  const labels = objectLabel ? [`${objectLabel} length`, `${objectLabel} run length`, "run length", "length"] : ["run length", "length"];
  const lengthMm = findLabeledMm(text, labels);
  const heightMm = findLabeledMm(text, ["bar height", "ledge height", "height"]);
  const schedule = objectLabel ? text.match(new RegExp(`\\b${objectLabel.replace(/\s+/g, "\\s+")}\\b[^.\\n]{0,80}?(\\d{3,6})\\s*(?:mm)?\\s*[xX]\\s*(\\d{3,5})\\s*(?:mm)?`, "i")) : null;
  if (schedule) {
    const a = Number(schedule[1]);
    const b = Number(schedule[2]);
    return { lengthMm: Math.max(a, b), heightMm: Math.min(a, b), method: "schedule" as const, excerpt: schedule[0].trim() };
  }
  return { lengthMm, heightMm, method: "explicit_text" as const, excerpt: lengthMm || heightMm ? wallSnippet(text) : null };
}

function resolveLinearElementGeometryFromPages(params: {
  pages: WallGeometryPage[];
  objectText?: string | null;
  calloutText?: string | null;
  sourceSheet?: string | null;
}): LinearElementGeometryEvidence {
  const objectLabel = inferLinearObject(`${params.objectText || ""} ${params.calloutText || ""}`);
  const itemCallout = extractLinearBarCallout(`${params.objectText || ""} ${params.calloutText || ""}`);
  const candidates = params.pages
    .filter((page) => isStructuralWallPage({ ...page, rawText: `${page.rawText} wall` }) || isScaleMeasurableLinearElement(page.rawText))
    .map((page) => ({ page, score: scoreLinearPage(page, params, objectLabel) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { page } of candidates) {
    const text = page.rawText.replace(/\s+/g, " ");
    const dimensions = extractLinearDimensions(text, objectLabel);
    const pageCallout = itemCallout.barCallout ? itemCallout : extractLinearBarCallout(text);
    if (dimensions.lengthMm || dimensions.heightMm || pageCallout.barCallout) {
      return {
        objectLabel,
        lengthMm: dimensions.lengthMm,
        heightMm: dimensions.heightMm,
        barCallout: pageCallout.barCallout,
        spacingMm: pageCallout.spacingMm,
        orientation: pageCallout.orientation,
        method: dimensions.method,
        confidence: dimensions.lengthMm && dimensions.heightMm && pageCallout.barCallout ? "high" : "medium",
        needsConfirmation: !(dimensions.lengthMm && dimensions.heightMm && pageCallout.barCallout),
        pageNumber: page.pageNumber,
        sheetTag: page.sheetTag,
        scaleRaw: page.scaleRaw,
        excerpt: dimensions.excerpt || wallSnippet(text),
        reason: dimensions.lengthMm || dimensions.heightMm ? "Found linear element dimensions in OCR text." : "Found linear element callout but dimensions still need confirmation.",
      };
    }
  }

  for (const { page } of candidates) {
    const scale = page.scaleRatio || parseScaleRatio(page.scaleRaw);
    const measured = measureLinearFromBbox(page.bbox, scale);
    if (measured) {
      return {
        objectLabel,
        lengthMm: measured.lengthMm,
        heightMm: measured.heightMm,
        barCallout: itemCallout.barCallout,
        spacingMm: itemCallout.spacingMm,
        orientation: itemCallout.orientation,
        method: "scale_measurement",
        confidence: itemCallout.barCallout && measured.heightMm ? "high" : "low",
        needsConfirmation: !(itemCallout.barCallout && measured.heightMm),
        pageNumber: page.pageNumber,
        sheetTag: page.sheetTag,
        scaleRaw: page.scaleRaw,
        excerpt: wallSnippet(page.rawText),
        reason: "Measured element bbox using sheet scale.",
      };
    }
  }

  return {
    objectLabel,
    lengthMm: null,
    heightMm: null,
    barCallout: itemCallout.barCallout,
    spacingMm: itemCallout.spacingMm,
    orientation: itemCallout.orientation,
    method: "not_found",
    confidence: itemCallout.barCallout ? "medium" : "low",
    needsConfirmation: true,
    reason: itemCallout.barCallout ? "Found bar callout, but no reliable element dimensions were found." : "No reliable linear element geometry was found.",
  };
}

function isStructuralWallPage(page: WallGeometryPage): boolean {
  const hay = `${page.discipline || ""} ${page.sheetTag || ""} ${page.rawText.slice(0, 500)}`.toLowerCase();
  return !/\barchitectural\b|^a[-\s]?\d/.test(hay)
    && /\bstruct|^s[-\s]?\d|foundation|wall|concrete|reinforc/i.test(hay)
    && /wall|foundation/i.test(page.rawText);
}

function scoreWallPage(page: WallGeometryPage, params: { objectText?: string | null; calloutText?: string | null; sourceSheet?: string | null }) {
  const text = page.rawText.toLowerCase();
  let score = 0;
  if (/foundation\s+wall|\bwall\b/.test(text)) score += 2;
  if (params.sourceSheet && String(page.sheetTag || "").toLowerCase().includes(String(params.sourceSheet).toLowerCase())) score += 2;
  for (const token of distinctiveTokens(`${params.objectText || ""} ${params.calloutText || ""}`)) {
    if (text.includes(token)) score += 1;
  }
  return score;
}

function distinctiveTokens(text: string) {
  return Array.from(new Set(text.toLowerCase().split(/[^a-z0-9.]+/).filter((token) => token.length >= 5 && !["foundation", "drawing", "enter"].includes(token)))).slice(0, 8);
}

function extractExplicitWallGeometry(text: string): Omit<WallGeometryEvidence, "confidence" | "needsConfirmation" | "reason"> & { method?: "explicit_text" | "schedule" } {
  const normalized = text.replace(/\s+/g, " ");
  const length = findLabeledMm(normalized, ["wall length", "run length", "foundation wall length", "length"]);
  const height = findLabeledMm(normalized, ["wall height", "height", "high"]);
  if (length || height) return { lengthMm: length, heightMm: height, method: "explicit_text", excerpt: wallSnippet(normalized) };

  const schedule = normalized.match(/\b(?:W\d+|FW\d+|FOUNDATION WALL|WALL)[^.\n]{0,80}?(\d{4,6})\s*(?:mm)?\s*[xX]\s*(\d{3,5})\s*(?:mm)?/i);
  if (schedule) {
    const a = Number(schedule[1]);
    const b = Number(schedule[2]);
    return { lengthMm: Math.max(a, b), heightMm: Math.min(a, b), method: "schedule", excerpt: schedule[0].trim() };
  }
  return { lengthMm: null, heightMm: null, method: "not_found" };
}

function findLabeledMm(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    const match = text.match(new RegExp(`\\b${escaped}\\s*(?:=|:|is)?\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*(mm|m)\\b`, "i"))
      || text.match(new RegExp(`\\b(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*(mm|m)\\s*(?:${escaped})\\b`, "i"));
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      return match[2].toLowerCase() === "m" ? value * 1000 : value;
    }
  }
  return null;
}

function measureWallFromBbox(bbox?: [number, number, number, number] | null, scaleRatio?: number | null) {
  if (!bbox || !scaleRatio || scaleRatio <= 0) return null;
  const widthPx = Math.abs(bbox[2] - bbox[0]);
  const heightPx = Math.abs(bbox[3] - bbox[1]);
  if (widthPx < 20 || heightPx < 2) return null;
  return Math.round(Math.max(widthPx, heightPx) * scaleRatio);
}

function measureLinearFromBbox(bbox?: [number, number, number, number] | null, scaleRatio?: number | null) {
  if (!bbox || !scaleRatio || scaleRatio <= 0) return null;
  const widthPx = Math.abs(bbox[2] - bbox[0]);
  const heightPx = Math.abs(bbox[3] - bbox[1]);
  if (widthPx < 20 || heightPx < 4) return null;
  const longPx = Math.max(widthPx, heightPx);
  const shortPx = Math.min(widthPx, heightPx);
  if (longPx / Math.max(shortPx, 1) > 80) return null;
  return {
    lengthMm: Math.round(longPx * scaleRatio),
    heightMm: Math.round(shortPx * scaleRatio),
  };
}

function wallSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

// Resolve a single AI line item against the graph. Pure function.
type GeometryStatus = "resolved" | "partial" | "unresolved";
interface ResolveResult {
  qty?: number;
  totalLengthM?: number;
  totalWeightKg?: number;
  status: GeometryStatus;
  missing: string[];
  derivation?: string;
}
function resolveLine(
  it: { description?: string; bar_size?: string; quantity_count?: number; total_length?: number; total_weight?: number; item_type?: string },
  graph: StructuralGraph,
): ResolveResult {
  const desc = String(it.description || "").toUpperCase();
  const size = String(it.bar_size || "").toUpperCase();
  const type = String(it.item_type || "rebar");
  const aiQty = Number(it.quantity_count) || 0;
  const aiLen = Number(it.total_length) || 0;
  const mass = massFor(size, type);

  // WWM/MESH: weight = mass(kg/m²) × area(m²). NEVER multiply by linear m.
  if (type === "wwm") {
    const massM2 = WWM_MASS_KG_PER_M2[size] || 0;
    const area = parseWwmAreaM2(`${it.description || ""}`);
    if (massM2 > 0 && area > 0) {
      return {
        qty: aiQty || 1,
        totalLengthM: 0,
        totalWeightKg: +(area * massM2).toFixed(2),
        status: "resolved",
        missing: [],
        derivation: `wwm: area=${area.toFixed(2)}m² × ${massM2}kg/m²`,
      };
    }
    return {
      qty: aiQty || 0,
      totalLengthM: 0,
      totalWeightKg: 0,
      status: "unresolved",
      missing: massM2 > 0 ? ["wwm coverage area (m² or sqft)"] : [`wwm spec ${size} not in mass table`],
    };
  }

  // CASE A — AI already produced a qty AND length backed by an explicit bar list.
  // Trust the AI value but require provenance: description must reference a mark
  // present in the graph OR contain explicit dimension tokens.
  if (aiQty > 0 && aiLen > 0) {
    const markMatch = desc.match(/\b(B[S]?\d{2,4})\b/);
    const hasDims = /\d{3,5}\s*MM/.test(desc);
    const known = markMatch ? graph.barMarks.has(markMatch[1]) : false;
    if (known || hasDims) {
      return {
        qty: aiQty,
        totalLengthM: aiLen,
        totalWeightKg: mass > 0 ? +(aiLen * mass).toFixed(2) : 0,
        status: "resolved",
        missing: [],
        derivation: known ? `mark ${markMatch![1]} from schedule` : "explicit dimensions in callout",
      };
    }
    // AI guessed without provenance — downgrade to partial
    return {
      qty: aiQty, totalLengthM: aiLen,
      totalWeightKg: mass > 0 ? +(aiLen * mass).toFixed(2) : 0,
      status: "partial",
      missing: ["provenance: no bar mark or explicit dimension found in description"],
    };
  }

  // CASE B — Try deterministic derivation from spacing + a wall
  const spMatch = desc.match(/@\s*(\d{2,4})\s*MM/);
  const spacing = spMatch ? Number(spMatch[1]) : 0;
  const wall = graph.walls.find((w) => (w.lengthMm || 0) > 0);
  if (spacing > 0 && wall?.lengthMm) {
    const lap = graph.lapTable.get(sizeKey(size)) ?? 0;
    const qty = Math.ceil(wall.lengthMm / spacing) + 1;
    const missing: string[] = [];
    let barLenMm = 0;
    if (!lap) missing.push(`lap length for ${sizeKey(size)} (Manual-Standard-Practice-2018)`);
    if (wall.heightMm && lap) barLenMm = wall.heightMm + lap;
    else if (!wall.heightMm) missing.push("wall height (mm)");
    if (barLenMm > 0) {
      const totalLengthM = +(qty * barLenMm / 1000).toFixed(2);
      return {
        qty, totalLengthM,
        totalWeightKg: +(totalLengthM * mass).toFixed(2),
        status: missing.length ? "partial" : "resolved",
        missing,
        derivation: `qty=ceil(${wall.lengthMm}/${spacing})+1=${qty}; bar=${(wall.heightMm || 0)}+${lap}mm`,
      };
    }
    return { qty, status: "partial", missing: ["bar developed length"], derivation: `qty=${qty} from wall`, };
  }

  // CASE C — bar mark referenced but no shape geometry available
  const markMatch = desc.match(/\b(B[S]?\d{2,4})\b/);
  if (markMatch) {
    const known = graph.barMarks.get(markMatch[1]);
    return {
      status: "unresolved",
      missing: known
        ? [`shape geometry for ${markMatch[1]}`, "host element dimensions"]
        : [`${markMatch[1]} not defined in any structural schedule`],
    };
  }

  // CASE D — concrete element placeholder, no rebar callout in OCR
  // Last-chance literal extraction: if the description itself contains an
  // explicit "N-<size>M" count and an explicit "<n>mm LONG" piece length,
  // we can honor those literal numbers as a PARTIAL row rather than leaving
  // it fully unresolved. This never invents values — both numbers must be
  // present verbatim in the OCR-derived description.
  {
    const litCount = desc.match(/\b(\d{1,3})\s*[-x]\s*(?:C)?(10M|15M|20M|25M|30M|35M)\b/);
    const litLen = desc.match(/\b(\d{2,5})\s*MM\s+LONG\b/);
    const litSpacing = desc.match(/@\s*(\d{2,4})\s*MM/);
    const sizeFromDesc = (litCount?.[2] || size) as string;
    const m = sizeFromDesc ? massFor(sizeFromDesc, type) : 0;
    if (litCount && litLen && m > 0) {
      const qty = Number(litCount[1]);
      const pieceM = Number(litLen[1]) / 1000;
      const totalLengthM = +(qty * pieceM).toFixed(2);
      return {
        qty,
        totalLengthM,
        totalWeightKg: +(totalLengthM * m).toFixed(2),
        status: "partial",
        missing: ["needs_confirmation"],
        derivation: `literal: qty=${qty}, piece=${litLen[1]}mm`,
      };
    }
    if (litCount && m > 0 && !litSpacing) {
      // Explicit count only (e.g. "2-15M TOP AND BOTTOM"). Record qty so the
      // row is partial instead of unresolved; length still needs the host
      // element dimensions to be confirmed by the estimator.
      return {
        qty: Number(litCount[1]),
        status: "partial",
        missing: ["host element length"],
        derivation: `literal qty=${litCount[1]} ${sizeFromDesc}`,
      };
    }
  }
  return {
    status: "unresolved",
    missing: ["rebar callout", "element dimensions"],
  };
}

function isWallItem(it: { description?: string; source_excerpt?: string | null }) {
  return /\b(foundation\s+wall|frost\s+wall|stem\s+wall|\bwall\b)/i.test(`${it.description || ""} ${it.source_excerpt || ""}`);
}

function isLinearElementItem(it: { description?: string; source_excerpt?: string | null }) {
  return isScaleMeasurableLinearElement(`${it.description || ""} ${it.source_excerpt || ""}`);
}

function wallBarOrientation(text: string): "vertical" | "horizontal" | "unknown" {
  const t = text.toUpperCase();
  if (/\b(HORIZONTAL|HORIZ|HEF|TOP|BOTTOM)\b/.test(t)) return "horizontal";
  if (/\b(VERTICAL|VERT|VEF|STAGGERED)\b/.test(t)) return "vertical";
  return "unknown";
}

function parseWallSpacingMm(text: string): number | null {
  const match = text.match(/(?:@|AT)\s*(\d+(?:\.\d+)?)\s*(?:MM)?\s*(?:\([^)]*\)\s*)?O\.?\s*C\.?/i);
  return match ? Number(match[1]) : null;
}

function applyWallGeometryResolution(
  it: any,
  current: ResolveResult,
  evidence: WallGeometryEvidence,
): ResolveResult {
  if (!isWallItem(it) || (!evidence.lengthMm && !evidence.heightMm)) return current;
  const desc = `${it.description || ""} ${it.source_excerpt || ""}`;
  const spacing = parseWallSpacingMm(desc);
  const orientation = wallBarOrientation(desc);
  const size = String(it.bar_size || "").toUpperCase();
  const mass = massFor(size, String(it.item_type || "rebar"));
  const missing = new Set<string>(current.missing || []);
  if (evidence.lengthMm) {
    missing.delete("wall length (mm)");
    missing.delete("wall length");
    missing.delete("element_dimensions");
  }
  if (evidence.heightMm) {
    missing.delete("wall height (mm)");
    missing.delete("wall height");
    missing.delete("element_dimensions");
  }

  let qty = current.qty;
  let totalLengthM = current.totalLengthM;
  let totalWeightKg = current.totalWeightKg;
  const derivationParts = [
    current.derivation,
    `wall_geometry=${evidence.method}`,
    evidence.lengthMm ? `length=${Math.round(evidence.lengthMm)}mm` : null,
    evidence.heightMm ? `height=${Math.round(evidence.heightMm)}mm` : null,
  ].filter(Boolean) as string[];

  if (spacing && orientation !== "horizontal" && evidence.lengthMm) {
    qty = Math.floor(evidence.lengthMm / spacing) + 1;
    derivationParts.push(`qty=floor(${Math.round(evidence.lengthMm)}/${spacing})+1=${qty}`);
    if (evidence.heightMm) {
      totalLengthM = Number((qty * evidence.heightMm / 1000).toFixed(3));
      totalWeightKg = mass ? Number((totalLengthM * mass).toFixed(2)) : undefined;
    } else {
      missing.add("wall height");
    }
  } else if (spacing && orientation === "horizontal" && evidence.heightMm) {
    qty = Math.floor(evidence.heightMm / spacing) + 1;
    derivationParts.push(`qty=floor(${Math.round(evidence.heightMm)}/${spacing})+1=${qty}`);
    if (evidence.lengthMm) {
      totalLengthM = Number((qty * evidence.lengthMm / 1000).toFixed(3));
      totalWeightKg = mass ? Number((totalLengthM * mass).toFixed(2)) : undefined;
    } else {
      missing.add("wall length");
    }
  } else if (spacing && evidence.lengthMm) {
    qty = Math.floor(evidence.lengthMm / spacing) + 1;
    derivationParts.push(`qty=floor(${Math.round(evidence.lengthMm)}/${spacing})+1=${qty}; orientation needs confirmation`);
    missing.add("wall bar orientation");
    if (!evidence.heightMm) missing.add("wall height");
  }

  const remaining = Array.from(missing).filter((m) => m && !/^rebar callout$/i.test(m));
  const status: GeometryStatus = totalLengthM && totalWeightKg && remaining.length === 0 && evidence.confidence !== "low"
    ? "resolved"
    : qty || evidence.lengthMm || evidence.heightMm
      ? "partial"
      : current.status;

  return {
    qty,
    totalLengthM,
    totalWeightKg,
    status,
    missing: remaining.length ? remaining : status === "partial" ? ["needs_confirmation"] : [],
    derivation: derivationParts.join("; "),
  };
}

function applyLinearGeometryResolution(
  it: any,
  current: ResolveResult,
  evidence: LinearElementGeometryEvidence,
): ResolveResult {
  if (!isLinearElementItem(it) || (!evidence.lengthMm && !evidence.heightMm && !evidence.barCallout)) return current;
  const desc = `${it.description || ""} ${it.source_excerpt || ""} ${evidence.barCallout || ""}`;
  const spacing = evidence.spacingMm || parseWallSpacingMm(desc);
  const orientation = evidence.orientation !== "unknown" ? evidence.orientation : wallBarOrientation(desc);
  const size = String(it.bar_size || "").toUpperCase();
  const mass = massFor(size, String(it.item_type || "rebar"));
  const missing = new Set<string>(current.missing || []);
  if (evidence.barCallout) missing.delete("rebar callout");
  if (evidence.lengthMm && evidence.heightMm) missing.delete("element dimensions");

  let qty = current.qty;
  let totalLengthM = current.totalLengthM;
  let totalWeightKg = current.totalWeightKg;
  const derivationParts = [
    current.derivation,
    `linear_geometry=${evidence.method}`,
    evidence.objectLabel ? `object=${evidence.objectLabel}` : null,
    evidence.lengthMm ? `length=${Math.round(evidence.lengthMm)}mm` : null,
    evidence.heightMm ? `height=${Math.round(evidence.heightMm)}mm` : null,
  ].filter(Boolean) as string[];

  if (spacing && evidence.lengthMm) {
    qty = Math.floor(evidence.lengthMm / spacing) + 1;
    derivationParts.push(`qty=floor(${Math.round(evidence.lengthMm)}/${spacing})+1=${qty}`);
    if (orientation !== "horizontal" && evidence.heightMm) {
      totalLengthM = Number((qty * evidence.heightMm / 1000).toFixed(3));
      totalWeightKg = mass ? Number((totalLengthM * mass).toFixed(2)) : undefined;
    } else if (orientation === "horizontal" && evidence.lengthMm && evidence.heightMm) {
      const hQty = Math.floor(evidence.heightMm / spacing) + 1;
      qty = hQty;
      totalLengthM = Number((hQty * evidence.lengthMm / 1000).toFixed(3));
      totalWeightKg = mass ? Number((totalLengthM * mass).toFixed(2)) : undefined;
    } else {
      missing.add("bar height");
    }
  } else if (!spacing) {
    missing.add("bar spacing");
  }

  const finalMissing = Array.from(missing).filter(Boolean);
  const status: GeometryStatus = qty && totalLengthM && totalWeightKg && finalMissing.length === 0
    ? "resolved"
    : (qty || evidence.barCallout || evidence.lengthMm || evidence.heightMm) ? "partial" : current.status;
  return {
    qty,
    totalLengthM,
    totalWeightKg,
    status,
    missing: status === "resolved" ? [] : finalMissing,
    derivation: derivationParts.join("; "),
  };
}

function inferSegmentType(label: string): string {
  const n = String(label || "").toLowerCase();
  if (/(retain|retaining)/.test(n)) return "retaining_wall";
  if (/(wall|frost wall|foundation wall)/.test(n)) return "wall";
  if (/(footing|ftg|pile cap|pile|caisson|grade beam|raft|mat)/.test(n)) return "footing";
  if (/(slab|sog|slab[- ]on[- ]grade|topping|deck)/.test(n)) return "slab";
  if (/(beam|girder|joist|lintel|bond beam)/.test(n)) return "beam";
  if (/(column|col\b)/.test(n)) return "column";
  if (/(pier)/.test(n)) return "pier";
  if (/(stair)/.test(n)) return "stair";
  if (/(pit|sump|elevator pit)/.test(n)) return "pit";
  if (/(curb|stoop|ledge|housekeeping pad|equipment pad)/.test(n)) return "curb";
  return "miscellaneous";
}

function itemMatchesSegment(item: { description?: string; source_excerpt?: string | null }, segType: string, segName: string): boolean {
  if (segType === "miscellaneous") return true;
  const text = `${item.description || ""} ${item.source_excerpt || ""}`.toUpperCase();
  const name = String(segName || "").toUpperCase();
  const tests: Record<string, RegExp> = {
    footing: /\b(FOOTING|FTG|F-\d|WF-\d|LEVELING PAD|PILE\s?CAP|PILE|CAISSON|GRADE\s?BEAM|RAFT|MAT)\b/,
    slab: /\b(SLAB|SOG|SLAB[-\s]?ON[-\s]?GRADE|FROST SLAB|WWM|W\.W\.M|MESH|6X6|HOUSEKEEPING PAD|PAD EDGE)\b/,
    wall: /\b(WALL|FOUNDATION WALL|RETAINING WALL|BRICK LEDGE|DOOR OPENINGS|VERTICAL BARS|STAGGERED)\b/,
    retaining_wall: /\b(RETAINING|RETAINING WALL)\b/,
    column: /\b(COLUMN|COL\b|C-\d)\b/,
    pier: /\b(PIER|P-\d)\b/,
    beam: /\b(BEAM|GIRDER|JOIST|LINTEL|BOND BEAM|GB-\d|B-\d{2,})\b/,
    stair: /\b(STAIR)\b/,
    pit: /\b(PIT|SUMP|ELEVATOR PIT)\b/,
    curb: /\b(CURB|STOOP|LEDGE|HOUSEKEEPING PAD|EQUIPMENT PAD)\b/,
  };
  const rx = tests[segType];
  if (rx?.test(text)) return true;
  return !!(name && name.length >= 4 && text.includes(name));
}

// --- Raw-input ask helpers (deterministic) -----------------------------------
// Estimator questions must ask for drawing-direct values only. Never request
// derived totals (perimeter, total length, qty, weight). System computes those.
function classifyElementForAsk(text: string): "slab_edge"|"strip_footing"|"pad"|"wall"|"cage"|"generic" {
  const t = (text || "").toLowerCase();
  if (/\b(slab\s*edge|frost\s*slab|slab\s*on\s*grade|sog\b|edge\s*of\s*slab)/.test(t)) return "slab_edge";
  if (/\b(strip\s*footing|cont(?:inuous)?\s*footing|wall\s*footing|footing|ftg)\b/.test(t)) return "strip_footing";
  if (/\b(housekeeping\s*pad|equipment\s*pad|pad)\b/.test(t)) return "pad";
  if (/\b(wall|stem\s*wall|foundation\s*wall|retaining\s*wall)\b/.test(t)) return "wall";
  if (/\b(column|pier|cage|tie\s*column)\b/.test(t)) return "cage";
  return "generic";
}
function elementNounForAsk(c: string): string {
  return ({ slab_edge: "slab", strip_footing: "strip footing", pad: "housekeeping pad", wall: "wall", cage: "column or pier", generic: "element" } as Record<string,string>)[c] || "element";
}
function rawInputPhraseForAsk(token: string, c: string): string | null {
  const k = (token || "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (/(perimeter|edge_length|edge_run|run_length|^length$|total_length|element_length)/.test(k)) {
    if (c === "slab_edge") return "the slab length and slab width";
    if (c === "wall")      return "the wall length";
    if (c === "pad")       return "the pad length and pad width";
    if (c === "strip_footing") return "the footing length";
    return "the length";
  }
  if (/(wall_height|^height$)/.test(k)) return "the wall height";
  if (/(pad_length|pad_width|element_dimensions|dimensions|footprint|plan_dim)/.test(k)) {
    if (c === "wall") return "the wall length and wall height";
    if (c === "slab_edge") return "the slab length and slab width";
    if (c === "pad") return "the pad length and pad width";
    return "the length and width";
  }
  if (/(spacing|o_c|on_center)/.test(k)) return "the bar spacing";
  if (/(count|qty|quantity)/.test(k)) return "the bar count";
  if (/(rebar_callout|^callout$|bar_callout|mark)/.test(k)) return "the rebar callout text";
  if (/(cover)/.test(k)) return "the concrete cover";
  if (/(thickness)/.test(k)) return "the thickness";
  if (/(diameter)/.test(k)) return "the diameter";
  return null;
}
function defaultRawInputForAsk(c: string): string {
  return ({
    slab_edge: "the slab length and slab width",
    strip_footing: "the footing length",
    pad: "the pad length and pad width",
    wall: "the wall length and wall height",
    cage: "the column or pier dimensions, tie spacing, and overall height",
    generic: "the dimensions and bar callout",
  } as Record<string,string>)[c] || "the dimensions and bar callout";
}

function cleanAnchorPhrase(value: string | null | undefined): string | null {
  const s = String(value || "").replace(/\s+/g, " ").replace(/^[@,:;\-\s]+|[@,:;\-\s]+$/g, "").trim();
  return s || null;
}

function isPageTag(value: string | null | undefined): boolean {
  const s = String(value || "").trim();
  return !s || /^(?:p|page)?\s*\d+$/i.test(s);
}

function cleanObjectAnchor(value: string | null | undefined): string | null {
  const s = cleanAnchorPhrase(value);
  return s && !isPageTag(s) ? s : null;
}

function normalizeDetailReference(value: string | null | undefined): string | null {
  const s = cleanObjectAnchor(value);
  if (!s) return null;
  const td = s.match(/^(?:T\.?\s*D\.?|TD)[\s#:.-]*([A-Z0-9][A-Z0-9./-]*)$/i);
  return td ? `T.D.${td[1]}` : s;
}

function classifyElementIds(elementId: string | null | undefined) {
  const id = cleanObjectAnchor(elementId)?.toUpperCase() || null;
  return {
    footing_id: id && /^(?:F|WF|SF|GB)\d+/i.test(id) ? id : null,
    wall_id: id && /^(?:W|FW)\d+/i.test(id) ? id : null,
    pad_id: id && /^(?:HKP|EQP)\d+/i.test(id) ? id : null,
    slab_zone_id: id && /^(?:SOG|SL|FZ|S-)\d+/i.test(id) ? id : null,
  };
}

function pickObjectIdentity(meta: Record<string, any>): string | null {
  return cleanObjectAnchor(
    meta.element_id
      || meta.callout_tag
      || meta.schedule_row_identity
      || meta.detail_reference
      || meta.grid_reference
      || meta.section_reference
  );
}

function inferQaAnchorMeta(...vals: Array<string | null | undefined>) {
  const text = vals.filter(Boolean).join(" \n ");
  const zoneMatch = text.match(/\b(?:AT|ALONG|NEAR)\s+(EXTENT OF\s+[A-Z][A-Z\s]+|ENTRANCE DOOR|WEST SIDE|EAST SIDE|NORTH SIDE|SOUTH SIDE)\b/i);
  const section = cleanObjectAnchor(text.match(/\bSECTION\s+([A-Z0-9./-]+)/i)?.[1] || null);
  const detail = normalizeDetailReference(
    text.match(/\b(?:DETAIL|DET\.?)[\s#:]*((?:T\.?\s*D\.?|TD)[\s#:.-]*[A-Z0-9][A-Z0-9./-]*|[A-Z0-9][A-Z0-9./-]*)/i)?.[1]
      || text.match(/\b((?:T\.?\s*D\.?|TD)[\s#:.-]*[A-Z0-9][A-Z0-9./-]*)\b/i)?.[1]
      || null
  );
  // Element-ID style callouts (HKP1, F12, WF3, GB2, W3, COL5, S-1, etc.)
  const ELEMENT_ID_RX = /\b(HKP\d+|EQP\d+|FW\d+|WF\d+|SF\d+|SOG\d+|SL\d+|FZ\d+|COL\d+|PIER\d+|PR\d+|BS?\d{2,4}|B\d{4}|F\d{1,3}|W\d{1,3}|GB\d{1,3}|D\d{2}(?:-\d+)?|S-\d+)\b/i;
  const callout = cleanObjectAnchor(text.match(ELEMENT_ID_RX)?.[1] || null);
  const elementId = callout ? callout.toUpperCase() : null;
  const typedIds = classifyElementIds(elementId);
  const grid = cleanObjectAnchor(text.match(/\bGRID\s+([A-Z]+-?\d+[A-Z]?)\b/i)?.[1] || null);
  const zone = cleanObjectAnchor(zoneMatch?.[1] || null);
  let element = cleanAnchorPhrase(
    text.match(/\b(HOUSEKEEPING PAD|EQUIPMENT PAD|LEVEL(?:I|E)NG PAD(?: AT ENTRANCE DOOR)?|FOUNDATION WALL(?: AT ENTRANCE DOOR)?|TOP OF BRICK LEDGE|BRICK LEDGE|FROST SLAB EDGE|SLAB EDGE|STRIP FOOTING|CONT(?:INUOUS)? FOOTING|DOOR OPENING)\b/i)?.[1] || null
  );
  if (element) element = element.toLowerCase();
  const schedule = cleanObjectAnchor(text.match(/\b(?:SCHEDULE|ROW)\s+([A-Z0-9./-]+)/i)?.[1] || callout || null);
  return {
    detail_reference: detail,
    section_reference: section,
    callout_tag: callout,
    element_id: elementId,
    ...typedIds,
    grid_reference: grid,
    zone_reference: zone,
    element_reference: element,
    schedule_row_identity: schedule && /^(10M|15M|20M|25M|30M|35M)$/i.test(schedule) ? null : schedule,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { segment_id, project_id } = await req.json();
    if (!segment_id || !project_id) {
      return new Response(JSON.stringify({ error: "segment_id and project_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gather context
    const [segRes, projRes, filesRes, stdRes, existingRes, searchIndexRes, knowledgeRes, sheetMetaRes] = await Promise.all([
      supabase.from("segments").select("*").eq("id", segment_id).single(),
      supabase.from("projects").select("name, project_type, scope_items, description").eq("id", project_id).single(),
      supabase.from("project_files").select("id, file_name, file_type").eq("project_id", project_id).limit(20),
      supabase.from("standards_profiles").select("*").eq("user_id", user.id).eq("is_default", true).limit(1),
      supabase.from("estimate_items").select("id, description, bar_size, quantity_count, total_length, total_weight, confidence").eq("segment_id", segment_id).limit(200),
      supabase.from("drawing_search_index").select("raw_text, page_number, extracted_entities, document_version_id").eq("project_id", project_id).limit(80),
      supabase.from("agent_knowledge").select("title, content, file_name").eq("user_id", user.id).limit(50),
      supabase.from("document_sheets").select("document_version_id,page_number,sheet_number,scale_raw,scale_ratio").eq("project_id", project_id).limit(200),
    ]);

    const segment = segRes.data;
    const project = projRes.data;
    const files = filesRes.data || [];
    const standard = stdRes.data?.[0];
    const existing = existingRes.data || [];
    const sheetMetaByKey = new Map<string, any>();
    for (const row of (sheetMetaRes.data || []) as any[]) {
      sheetMetaByKey.set(`${row.document_version_id || ""}:${Number(row.page_number) || 0}`, row);
    }

    // ============================================================
    // PROJECT-SPEC PRECEDENCE (lap / cover / grade)
    // Aggregate `specs` from extracted_entities (general-notes
    // extractor #6). Project-specific specs ALWAYS beat the user's
    // standards_profiles defaults, which beat CSA fallback.
    // ============================================================
    type ProjectSpecs = {
      lap: { tension_db?: number; compression_db?: number; splice_class?: string; splice_type?: string };
      cover: { top_mm?: number; bottom_mm?: number; side_mm?: number; against_earth_mm?: number; clear_mm?: number };
      grade: { fy_mpa?: number; fy_ksi?: number; mark?: string };
      hook: { standard_deg?: number; seismic_deg?: number };
      source_pages: number[];
    };
    const projectSpecs: ProjectSpecs = { lap: {}, cover: {}, grade: {}, hook: {}, source_pages: [] };
    for (const page of (searchIndexRes.data || []) as any[]) {
      const s = (page.extracted_entities as any)?.specs;
      if (!s || typeof s !== "object") continue;
      let touched = false;
      for (const k of ["tension_db","compression_db","splice_class","splice_type"] as const) {
        if (s.lap?.[k] != null && projectSpecs.lap[k] == null) { (projectSpecs.lap as any)[k] = s.lap[k]; touched = true; }
      }
      for (const k of ["top_mm","bottom_mm","side_mm","against_earth_mm","clear_mm"] as const) {
        if (s.cover?.[k] != null && projectSpecs.cover[k] == null) { (projectSpecs.cover as any)[k] = s.cover[k]; touched = true; }
      }
      for (const k of ["fy_mpa","fy_ksi","mark"] as const) {
        if (s.grade?.[k] != null && projectSpecs.grade[k] == null) { (projectSpecs.grade as any)[k] = s.grade[k]; touched = true; }
      }
      for (const k of ["standard_deg","seismic_deg"] as const) {
        if (s.hook?.[k] != null && projectSpecs.hook[k] == null) { (projectSpecs.hook as any)[k] = s.hook[k]; touched = true; }
      }
      if (touched && page.page_number != null) projectSpecs.source_pages.push(Number(page.page_number));
    }
    const hasProjectLap = Object.keys(projectSpecs.lap).length > 0;
    const hasProjectCover = Object.keys(projectSpecs.cover).length > 0;
    const hasProjectGrade = Object.keys(projectSpecs.grade).length > 0;
    const lapSourceLabel = hasProjectLap ? "project_spec_extracted" : (standard?.lap_defaults ? "standards_profile" : "csa_fallback");
    const coverSourceLabel = hasProjectCover ? "project_spec_extracted" : (standard?.cover_defaults ? "standards_profile" : "csa_fallback");
    const gradeSourceLabel = hasProjectGrade ? "project_spec_extracted" : (standard?.code_family ? "standards_profile" : "csa_fallback");
    console.log(`[auto-estimate] spec_precedence lap=${lapSourceLabel} cover=${coverSourceLabel} grade=${gradeSourceLabel} pages=${projectSpecs.source_pages.join(",") || "none"}`);

    // Map document_version_id -> project_files.id for per-row provenance.
    // We need the document_versions.file_id (legacy file id) to reach project_files.id.
    const dvIds = Array.from(new Set(((searchIndexRes.data || []) as any[])
      .map((p) => p.document_version_id).filter(Boolean)));
    const dvToFileId = new Map<string, string>();
    if (dvIds.length > 0) {
      const { data: dvRows } = await supabase
        .from("document_versions")
        .select("id, file_id, file_name")
        .in("id", dvIds as string[]);
      const fileById = new Map((files as Array<{ id: string; file_name?: string }>)
        .map((f) => [f.id, f]));
      for (const dv of (dvRows || [])) {
        // Prefer matching by file_id (legacy upload id), fall back to file_name.
        if (dv.file_id && fileById.has(dv.file_id)) {
          dvToFileId.set(dv.id, dv.file_id);
        } else {
          const byName = (files as any[]).find((f: any) => f.file_name === dv.file_name);
          if (byName) dvToFileId.set(dv.id, byName.id);
        }
      }
    }

    // ============================================================
    // MANUAL-ONLY AUTHORITY GATE
    // Manual-Standard-Practice-2018 (uploaded into Brain) is the
    // ONLY allowed source of assumptions (lap, splice, hook, bend).
    // If the manual is not present and parsed (content > 1000 chars),
    // refuse to estimate — return a blocker the UI can render.
    // ============================================================
    const allKnowledge = (knowledgeRes.data || []) as Array<{ title?: string; content?: string; file_name?: string }>;
    // Manual is often ingested as multiple chunks (one per chapter). Aggregate
    // every entry whose title OR file_name matches the manual, then require the
    // combined parsed text to exceed 1000 chars.
    const manualChunks = allKnowledge.filter((k) => {
      const hay = `${k.title || ""} ${k.file_name || ""}`.toLowerCase();
      return /manual.*standard.*practice.*2018|standard.?practice.?2018|rsic.*manual/.test(hay)
        && (k.content || "").length > 0;
    });
    const manualCombined = manualChunks.map((k) => k.content || "").join("\n\n").trim();
    if (manualChunks.length === 0 || manualCombined.length < 1000) {
      console.warn("[auto-estimate] BLOCKED: Manual-Standard-Practice-2018 not loaded into Brain (or not parsed).");
      return new Response(JSON.stringify({
        success: false,
        blocked: true,
        reason: "MANUAL_NOT_LOADED",
        message: "Manual-Standard-Practice-2018 must be uploaded to Brain (with extracted text) before takeoff can run. No assumptions are allowed without manual citations.",
        items_created: 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const manualText = manualCombined.slice(0, 12000);

    // Build drawing text from search index (OCR), with strict source priority for
    // production rebar quantities:
    //   1. SHOP DRAWINGS  — PRIMARY quantity source
    //   2. STRUCTURAL     — SECONDARY verification / gap-fill
    //   3. ARCHITECTURAL  — CONTEXT ONLY, never quantified from
    // Pages are also filtered to those relevant to the current segment so each
    // segment is estimated against its own evidence, not the full project corpus.
    let drawingTextContext = "";
    const searchPages = (searchIndexRes.data || []) as Array<any>;

    // Segment-aware relevance filter. We classify each OCR page by which
    // construction bucket it talks about, and only feed pages relevant to
    // the current segment_type into the prompt. This stops the same wall /
    // slab / footing callouts from being repeated into every segment.
    const SEGMENT_TOKENS: Record<string, RegExp> = {
      footing:        /\b(FOOTING|FTG|PILE\s?CAP|PILE|CAISSON|GRADE\s?BEAM|RAFT|MAT|F-?\d|FROST\s?WALL|FROST)\b/,
      slab:           /\b(SLAB|SOG|SLAB[-\s]?ON[-\s]?GRADE|TOPPING|DECK|WWM|MESH|6X6-?W)\b/,
      wall:           /\b(WALL|FOUNDATION\s?WALL|RETAINING\s?WALL|SHEAR\s?WALL|CMU|ICF|FW-?\d)\b/,
      retaining_wall: /\b(RETAINING|RETAINING\s?WALL)\b/,
      column:         /\b(COLUMN|\bCOL\b|C-?\d)\b/,
      pier:           /\b(PIER|P-?\d)\b/,
      beam:           /\b(BEAM|GIRDER|JOIST|LINTEL|BOND\s?BEAM|GB-?\d|B-?\d{3,})\b/,
      stair:          /\b(STAIR)\b/,
      pit:            /\b(PIT|SUMP|ELEVATOR\s?PIT)\b/,
      curb:           /\b(CURB|STOOP|LEDGE|HOUSEKEEPING\s?PAD|EQUIPMENT\s?PAD)\b/,
    };
    const storedSegType = String(segment?.segment_type || "miscellaneous").toLowerCase();
    const inferredSegType = inferSegmentType(String(segment?.name || ""));
    const segTypeKey = storedSegType !== "miscellaneous" ? storedSegType : inferredSegType;
    const segNameUpper = String(segment?.name || "").toUpperCase();
    const segRelevance = SEGMENT_TOKENS[segTypeKey] || null;
    const isPageRelevant = (text: string): boolean => {
      if (!segRelevance) return true; // miscellaneous → keep all pages
      const u = text.toUpperCase();
      if (segRelevance.test(u)) return true;
      // also accept pages that mention the literal segment name
      if (segNameUpper && segNameUpper.length >= 4 && u.includes(segNameUpper)) return true;
      return false;
    };
    // Build a per-page → file map so the model can cite source sheet
    const fileByName = new Map<string, { id: string; file_name: string }>();
    for (const f of files as Array<{ id: string; file_name?: string }>) {
      if (f.file_name) fileByName.set(f.file_name.toUpperCase(), { id: f.id, file_name: f.file_name });
    }
    const isShopName = (n: string) => /\bSHOP\b|^SD[\s_-]?\d|\bSD\d/i.test(n || "");
    const isStructName = (n: string) => /\bSTRUCT|^S[\s_-]?\d|\bSTR[-_\s]/i.test(n || "");
    const isArchName = (n: string) => /\bARCH|^A[\s_-]?\d/i.test(n || "");
    // Per-page metadata so we can later resolve provenance back to a file.
    type RelevantPage = { snip: string; document_version_id: string | null; page_number: number; sheetTag: string };
    const relevantPages: RelevantPage[] = [];
    const wallGeometryPages: WallGeometryPage[] = [];
    if (searchPages.length > 0) {
      const shop: string[] = [];
      const structural: string[] = [];
      const architectural: string[] = [];
      const other: string[] = [];
      for (const page of searchPages) {
        const text = (page.raw_text || "").trim();
        if (text.length <= 20) continue;
        const tb = (page.extracted_entities as any)?.title_block || {};
        const dvFileId = page.document_version_id ? dvToFileId.get(String(page.document_version_id)) : null;
        const dvFileName = dvFileId
          ? String((files as any[]).find((f: any) => f.id === dvFileId)?.file_name || "")
          : "";
        const disc = String(tb.discipline || "").toLowerCase();
        const sheetMeta = sheetMetaByKey.get(`${page.document_version_id || ""}:${Number(page.page_number) || 0}`) || {};
        const sheetTag = (page.extracted_entities as any)?.title_block?.sheet_id
          || (page.extracted_entities as any)?.title_block?.sheet_number
          || sheetMeta.sheet_number
          || `p${page.page_number}`;
        const isStructuralForGeometry = disc.includes("struct")
          || isStructName(dvFileName)
          || /\bS-\d|FOUNDATION PLAN|FOUNDATION WALL|CONCRETE REINFORCING|LEVELING PAD|F-\d|WF-\d/i.test(text.slice(0, 700));
        if (isStructuralForGeometry && !isArchName(dvFileName)) {
          wallGeometryPages.push({
            pageNumber: Number(page.page_number) || 0,
            sheetTag: String(sheetTag),
            rawText: text,
            discipline: disc || "structural",
            scaleRaw: sheetMeta.scale_raw || tb.scale || tb.scale_raw || null,
            scaleRatio: Number(sheetMeta.scale_ratio || 0) || parseScaleRatio(tb.scale || tb.scale_raw || null),
          });
        }
        if (!isPageRelevant(text)) continue;
        // Sheet-category gate (#5): skip pages explicitly marked non-rebar-relevant
        // by populate-search-index / reindex-extractors (e.g. arch/MEP/landscape).
        // Treat missing flag as relevant (backward compatible with un-reindexed data).
        const rebarRelevant = (page.extracted_entities as any)?.rebar_relevant;
        if (rebarRelevant === false) {
          continue;
        }
        const snip = `[SHEET ${sheetTag} · Page ${page.page_number}] ${text.substring(0, 2000)}`;
        relevantPages.push({ snip, document_version_id: page.document_version_id || null, page_number: Number(page.page_number) || 0, sheetTag: String(sheetTag) });
        if (disc.includes("shop") || isShopName(dvFileName) || /\bSD\b|SHOP DRAWING/i.test(text.slice(0, 200))) shop.push(snip);
        else if (disc.includes("struct") || isStructName(dvFileName) || /\bS-\d|FOUNDATION PLAN|ELEVATIONS|CONCRETE REINFORCING|LEVELING PAD|F-\d|WF-\d/i.test(text.slice(0, 400))) structural.push(snip);
        else if (disc.includes("arch") || isArchName(dvFileName)) architectural.push(snip);
        else other.push(snip);
      }
      console.log(`[auto-estimate] segment="${segment?.name}" stored_type=${storedSegType} effective_type=${segTypeKey} relevant_pages=${relevantPages.length}/${searchPages.length}`);
      const parts: string[] = [];
      if (shop.length > 0) {
        parts.push("=== SHOP DRAWING OCR (PRIMARY — production quantities come from here) ===\n" + shop.join("\n\n"));
      }
      if (structural.length > 0) {
        parts.push("=== STRUCTURAL OCR (SECONDARY — verify shop quantities, fill gaps) ===\n" + structural.join("\n\n"));
      }
      if (other.length > 0) {
        parts.push("=== UNCLASSIFIED OCR ===\n" + other.join("\n\n"));
      }
      if (architectural.length > 0) {
        // Architectural is CONTEXT ONLY — never feed body text to quantity prompt.
        const archTitles = architectural.slice(0, 6).map((s) => s.split("\n")[0]).join("\n");
        parts.push("=== ARCHITECTURAL OCR (CONTEXT ONLY — DO NOT QUANTIFY FROM) ===\n" + archTitles);
      }
      drawingTextContext = parts.join("\n\n").slice(0, 14000);
    } else {
      try {
        const { data: docVersions } = await supabase
          .from("document_versions")
          .select("pdf_metadata, file_name")
          .eq("project_id", project_id)
          .limit(10);
        if (docVersions && docVersions.length > 0) {
          const textSnippets: string[] = [];
          for (const dv of docVersions) {
            const meta = dv.pdf_metadata as any;
            if (meta?.pages) {
              for (const page of meta.pages.slice(0, 5)) {
                if (page.raw_text) {
                  textSnippets.push(`[${dv.file_name} p${page.page_number}] ${page.raw_text.slice(0, 1500)}`);
                }
              }
            }
          }
          drawingTextContext = textSnippets.join("\n\n").slice(0, 8000);
        }
      } catch (drawErr) {
        console.warn("Could not fetch drawing text:", drawErr);
      }
    }

    // If the segment-aware filter removed everything, refuse to estimate.
    // Generating against the full corpus is exactly the bug we are fixing.
    if (searchPages.length > 0 && relevantPages.length === 0) {
      console.warn(`[auto-estimate] No drawing pages relevant to segment "${segment?.name}" (${segTypeKey}). Skipping.`);
      return new Response(JSON.stringify({
        success: true,
        items_created: 0,
        skipped: true,
        reason: "NO_RELEVANT_DRAWING_PAGES",
        message: `No OCR pages mention this segment (${segment?.name}). Upload or re-parse the relevant drawing.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build RSIC knowledge context
    let knowledgeContext = "";
    const knowledgeEntries = knowledgeRes.data || [];
    if (knowledgeEntries.length > 0) {
      const relevant = knowledgeEntries.filter((k: any) =>
        /RSIC|standard|rebar|mass|weight|bar.*size|estimat/i.test(k.title || "") ||
        /RSIC|standard|rebar|mass|weight|bar.*size|estimat/i.test((k.content || "").substring(0, 200))
      );
      if (relevant.length > 0) {
        knowledgeContext = "\n=== RSIC STANDARDS REFERENCE ===\n";
        for (const k of relevant.slice(0, 3)) {
          knowledgeContext += `[${k.title}]\n${(k.content || "").substring(0, 2000)}\n\n`;
        }
      }
    }

    // Detect scope coverage from file names AND OCR drawing tokens (5 construction buckets).
    // Buckets are universal across project types — never hard-code a single project's scope.
    const fileNames = files.map((f: any) => (f.file_name || "").toUpperCase());
    const ocrUpper = (drawingTextContext || "").toUpperCase();
    const corpus = `${fileNames.join(" ")} ${ocrUpper}`;
    const BUCKET_TOKENS: Record<string, RegExp> = {
      FOUNDATION: /FOOTING|FOUND|FTG|PILE|CAISSON|RAFT|MAT|PILE.?CAP|GRADE.?BEAM|FROST.?WALL/,
      VERTICAL:   /\bWALL\b|\bCOLUMN\b|\bCOL\b|PIER|SHEAR|RETAINING|CMU|ICF/,
      HORIZONTAL: /\bBEAM\b|GIRDER|JOIST|LINTEL|BOND.?BEAM/,
      SLAB:       /\bSLAB\b|\bSOG\b|SLAB.?ON.?GRADE|SUSPENDED|TOPPING|DECK/,
      MISC:       /STAIR|LEDGE|CURB|STOOP|EQUIPMENT.?PAD|ELEVATOR.?PIT|SUMP|TRANSFORMER/,
    };
    const bucketsPresent = Object.entries(BUCKET_TOKENS)
      .filter(([_, rx]) => rx.test(corpus)).map(([k]) => k);
    const bucketsAbsent = Object.keys(BUCKET_TOKENS).filter((k) => !bucketsPresent.includes(k));
    const scopeHint = project?.scope_items?.length
      ? project.scope_items.join(", ")
      : (bucketsPresent.length
          ? `BUCKETS PRESENT: ${bucketsPresent.join(", ")}. BUCKETS ABSENT (do NOT estimate): ${bucketsAbsent.join(", ") || "none"}`
          : "");

    if (!segment) {
      return new Response(JSON.stringify({ error: "Segment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingDesc = existing.map((e: any) => e.description).filter(Boolean).join(", ");
    // Normalized key for de-dup (segment-scoped)
    const normKey = (desc: string, size: string) =>
      `${(desc || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 #@\.\-]/g, "").trim()}|${(size || "").toUpperCase().trim()}`;
    const existingKeys = new Set(
      (existing as Array<{ description?: string; bar_size?: string }>).map((e) => normKey(e.description || "", e.bar_size || "")),
    );

    const systemPrompt = `You are a rebar EXTRACTION assistant. You DO NOT compute geometry. A deterministic resolver downstream will calculate qty, length and weight. Your job is to faithfully extract rebar callouts from the drawing text and CITE THE MANUAL for any assumption.
Rules:
- Return ONLY a JSON array of objects, no markdown, no explanation.
- Each object: { "description": string, "bar_size": string, "quantity_count": number, "total_length": number, "total_weight": number, "confidence": number, "item_type": "rebar" | "wwm", "source_sheet": string | null, "source_excerpt": string | null, "authority_section": string | null, "authority_page": number | null, "authority_quote": string | null }
- SOURCE PRIORITY (production rebar quantities):
    1. SHOP DRAWING OCR  — PRIMARY. Quantities MUST come from here when present.
    2. STRUCTURAL OCR    — SECONDARY. Use only to verify or fill gaps not in shop drawings.
    3. ARCHITECTURAL OCR — CONTEXT ONLY. NEVER derive a quantity from architectural sheets.
- ASSUMPTION AUTHORITY: The ONLY allowed source for assumption rules (lap, splice, hook, bend, development length) is "Manual-Standard-Practice-2018" provided below. Every row that uses an assumption MUST set authority_section, authority_page (if available) and authority_quote. If the manual does not cover the needed rule, leave the geometry fields 0 — the resolver will mark UNRESOLVED. NEVER invent a value.
- Always include "source_sheet" with the SHEET tag from the OCR header (e.g. "SD-06") and "source_excerpt" with a verbatim quoted phrase from that sheet.
- Extraction policy:
  * If a bar list / footing schedule row is explicitly visible (Mark, Qty, Size, Total Length), copy those EXACT numbers into quantity_count and total_length (m). Set confidence 0.9.
  * If a callout is visible but the geometry is referenced indirectly (e.g. "17 10M BS80 @300 DWL", "1 20M B2035 TOP CONT. IF"), extract ONLY what is literally written: include the bar mark in the description, set quantity_count to the literal count if shown, leave total_length=0, total_weight=0, confidence 0.4. The downstream resolver will compute the rest.
  * NEVER invent dimensions, spacing, wall heights or lap lengths. NEVER guess. If a number is not literally on the drawing, leave it 0.
- Bar sizes: use metric (10M, 15M, 20M, 25M, 30M, 35M) or imperial (#3..#8).
- WIRE MESH (WWM): if mesh designations appear, set item_type="wwm", bar_size=mesh designation. Leave area=0 unless slab dimensions are literally given.
- Always include the bar mark (BSxx, Bxxxx) in the description verbatim when present — the resolver keys off it.
- Quote the source phrase from OCR in the description so provenance can be checked, e.g. "17 10M BS80 @300 DWL.".
- ${scopeHint ? `SCOPE RESTRICTION: ${scopeHint}` : ""}
- Do NOT duplicate items already estimated: ${existingDesc || "none yet"}.`;

    const fewShot = `EXAMPLES of correct EXTRACTION (do not compute):
OCR snippet: "17 10M BS80 @300 DWL." →
  {"description":"17 10M BS80 @300 DWL.","bar_size":"10M","quantity_count":17,"total_length":0,"total_weight":0,"confidence":0.4,"item_type":"rebar"}
OCR snippet bar list row "BS31  12  15M  3650mm  Type 1" →
  {"description":"BS31 Type 1","bar_size":"15M","quantity_count":12,"total_length":43.80,"total_weight":68.77,"confidence":0.9,"item_type":"rebar"}`;

    const userPrompt = `Project: ${project?.name || "Unknown"}
Type: ${project?.project_type || "Unknown"}
Scope: ${(project?.scope_items || []).join(", ") || "Not defined"}
Files: ${files.map((f: any) => f.file_name).join(", ") || "None"}

Segment: ${segment.name}
Type: ${segment.segment_type}
Level: ${segment.level_label || "Not specified"}
Zone: ${segment.zone_label || "Not specified"}
Notes: ${segment.notes || "None"}

Standards: ${standard ? `${standard.name} (${standard.code_family}, ${standard.units})` : "Default metric"}
Cover defaults: ${standard?.cover_defaults ? JSON.stringify(standard.cover_defaults) : "Standard"}
Lap defaults: ${standard?.lap_defaults ? JSON.stringify(standard.lap_defaults) : "Standard"}

=== PROJECT SPEC PRECEDENCE (use FIRST, before standards/CSA fallback) ===
Source for LAP rules:   ${lapSourceLabel}${hasProjectLap ? ` -> ${JSON.stringify(projectSpecs.lap)}` : ""}
Source for COVER rules: ${coverSourceLabel}${hasProjectCover ? ` -> ${JSON.stringify(projectSpecs.cover)}` : ""}
Source for GRADE rules: ${gradeSourceLabel}${hasProjectGrade ? ` -> ${JSON.stringify(projectSpecs.grade)}` : ""}
Spec extractor pages:   ${projectSpecs.source_pages.join(", ") || "none"}
RULE: If a project_spec_extracted value exists, USE IT and cite the page in authority_quote (e.g. "Spec sheet p${projectSpecs.source_pages[0] ?? "?"}: tension lap = Xdb"). Only fall back to standards/CSA if the project value is missing for that field.
=== END PROJECT SPEC PRECEDENCE ===

${knowledgeContext}

=== ASSUMPTION AUTHORITY (Manual-Standard-Practice-2018) ===
${manualText}
=== END ASSUMPTION AUTHORITY ===

${drawingTextContext ? `=== DRAWING TEXT ===\n${drawingTextContext}\n=== END DRAWING TEXT ===` : "NO DRAWING TEXT AVAILABLE. DO NOT ESTIMATE. Return an empty JSON array []."}

Generate estimate items for this segment. Base quantities on the ACTUAL drawing data if available, not assumptions.

${fewShot}

Output the JSON array now. Extract literally from the OCR; do not guess geometry. Lines without an explicit bar-list row should keep total_length=0 — the deterministic resolver will compute it.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extractionTools = [{
      type: "function",
      function: {
        name: "return_estimate_items",
        description: "Return extracted rebar estimate items for the current segment.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  bar_size: { type: "string" },
                  quantity_count: { type: "number" },
                  total_length: { type: "number" },
                  total_weight: { type: "number" },
                  confidence: { type: "number" },
                  item_type: { type: "string", enum: ["rebar", "wwm"] },
                  source_sheet: { type: ["string", "null"] },
                  source_excerpt: { type: ["string", "null"] },
                  authority_section: { type: ["string", "null"] },
                  authority_page: { type: ["number", "null"] },
                  authority_quote: { type: ["string", "null"] },
                },
                required: [
                  "description",
                  "bar_size",
                  "quantity_count",
                  "total_length",
                  "total_weight",
                  "confidence",
                  "item_type",
                  "source_sheet",
                  "source_excerpt",
                  "authority_section",
                  "authority_page",
                  "authority_quote"
                ],
                additionalProperties: false,
              },
            },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
    }];

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: extractionTools,
        tool_choice: { type: "function", function: { name: "return_estimate_items" } },
        temperature: 0,
        max_tokens: 32000,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", status, errText);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const aiMessage = aiData.choices?.[0]?.message || {};
    const toolArgs = aiMessage.tool_calls?.[0]?.function?.arguments;
    const content = aiMessage.content;
    const rawContent = typeof toolArgs === "string"
      ? toolArgs
      : typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part: any) => {
            if (typeof part === "string") return part;
            if (typeof part?.text === "string") return part.text;
            if (typeof part?.content === "string") return part.content;
            if (Array.isArray(part?.content)) {
              return part.content.map((nested: any) => nested?.text || nested?.content || "").join("");
            }
            return "";
          }).join("")
          : Array.isArray(content?.items) || Array.isArray(content)
            ? JSON.stringify(content)
            : content && typeof content === "object"
              ? JSON.stringify(content)
              : "";
    const finishReason = aiData.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      console.warn("[auto-estimate] AI response truncated (finish_reason=length)");
    }

    // Parse JSON from response (strip markdown fences if present)
    let items: any[];
    try {
      if (typeof toolArgs === "string") {
        const parsed = JSON.parse(toolArgs);
        items = Array.isArray(parsed) ? parsed : parsed.items;
        if (!Array.isArray(items)) throw new Error("Tool output missing items array");
      } else if (Array.isArray(content) && content.every((item: any) => item && typeof item === "object" && !("type" in item))) {
        items = content;
      } else {
      let jsonStr = rawContent.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      // Slice from first '[' to last ']' to drop any prose preamble/postamble
      const start = jsonStr.indexOf("[");
      const end = jsonStr.lastIndexOf("]");
      if (start !== -1 && end > start) jsonStr = jsonStr.slice(start, end + 1);
      // Strip trailing commas before ] or }
      jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
      items = JSON.parse(jsonStr);
      if (!Array.isArray(items)) throw new Error("Not an array");
      }
    } catch {
      // Repair truncated JSON: keep only complete top-level objects in the array
      try {
        let s = rawContent.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        const startIdx = s.indexOf("[");
        if (startIdx === -1) throw new Error("no array");
        s = s.slice(startIdx + 1);
        const objs: string[] = [];
        let depth = 0, inStr = false, esc = false, buf = "";
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          buf += ch;
          if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') { inStr = true; continue; }
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              const trimmed = buf.trim().replace(/^,\s*/, "");
              try { objs.push(JSON.stringify(JSON.parse(trimmed))); } catch { /* skip */ }
              buf = "";
            }
          }
        }
        if (objs.length === 0) throw new Error("no complete objects");
        items = JSON.parse("[" + objs.join(",") + "]");
        console.warn(`[auto-estimate] Repaired truncated JSON: kept ${items.length} complete items (finish=${finishReason})`);
      } catch {
        console.error("Failed to parse AI response:", rawContent);
        return new Response(JSON.stringify({ error: "AI returned invalid format. Please try again." }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ============================================================
    // DETERMINISTIC GEOMETRY RESOLVER
    // The AI extracted callouts; we now compute qty/length/weight
    // from the structural graph and tag each row with a geometry
    // status so the UI can render UNRESOLVED rows honestly.
    // ============================================================
    const structuralOnly = (drawingTextContext || "")
      .split("=== ARCHITECTURAL OCR")[0]; // never feed arch OCR to geometry
    const graph = buildStructuralGraph(structuralOnly);
    console.log(`[auto-estimate] graph: ${graph.barMarks.size} marks, ${graph.walls.length} walls, ${graph.footings.length} footings, ${graph.verifyNotes.length} verify notes`);

    const enriched = items.map((it: any) => {
      const wallGeometry = isWallItem(it)
        ? resolveWallGeometryFromPages({
          pages: wallGeometryPages,
          objectText: it.description || null,
          calloutText: it.source_excerpt || it.description || null,
          sourceSheet: it.source_sheet || null,
        })
        : null;
      const linearGeometry = !wallGeometry && isLinearElementItem(it)
        ? resolveLinearElementGeometryFromPages({
          pages: wallGeometryPages,
          objectText: it.description || null,
          calloutText: it.source_excerpt || it.description || null,
          sourceSheet: it.source_sheet || null,
        })
        : null;
      const baseResolution = resolveLine(it, graph);
      const wallResolved = wallGeometry ? applyWallGeometryResolution(it, baseResolution, wallGeometry) : baseResolution;
      const r = linearGeometry ? applyLinearGeometryResolution(it, wallResolved, linearGeometry) : wallResolved;
      const baseDesc = String(it.description || "").trim();
      const isUnresolved = r.status === "unresolved";
      const cleanDesc = baseDesc.replace(/^UNRESOLVED:\s*/i, "");
      return {
        ...it,
        description: cleanDesc,
        quantity_count: r.qty ?? 0,
        total_length: r.totalLengthM ?? 0,
        total_weight: r.totalWeightKg ?? 0,
        // Confidence: resolved keeps AI confidence (capped 0.95), partial halved, unresolved 0
        confidence: isUnresolved ? 0
          : r.status === "partial" ? Math.min(Number(it.confidence) || 0.4, 0.5)
          : Math.min(Number(it.confidence) || 0.7, 0.95),
        _geometry_status: r.status,
        _missing_refs: r.missing,
        _derivation: r.derivation || null,
        _wall_geometry: wallGeometry,
        _linear_geometry: linearGeometry,
      };
    });
    items = enriched.filter((it: any) => itemMatchesSegment(it, segTypeKey, String(segment?.name || "")));
    console.log(`[auto-estimate] post-filter rows=${items.length} for segment="${segment?.name}" effective_type=${segTypeKey}`);

    // Object-first page locator. For each item we build a ranked list of
    // anchor candidates (detail / section / callout / grid / element /
    // schedule row / excerpt token / bar mark / bar size), find the first
    // candidate that appears in any OCR page, and record:
    //   _page_number       — the page where the anchor appears
    //   _anchor_text       — the exact token QA should pin on
    //   _anchor_kind       — what type of object that token is
    //   _anchor_confidence — confidence the anchor identifies the host
    //   _anchor_mode       — "exact" | "approximate" | "unavailable"
    // QA consumes these directly, so it never has to guess from loose text.
    {
      const pages = (searchPages || [])
        .filter((p: any) => p && (p.raw_text || "").length > 20)
        .map((p: any) => ({ page_number: Number(p.page_number) || 1, text: String(p.raw_text || "").toUpperCase() }));
      type AnchorKind = "element_id" | "detail" | "section" | "callout" | "grid" | "element" | "schedule" | "excerpt" | "mark" | "size";
      const KIND_SCORE: Record<AnchorKind, number> = {
        element_id: 0.99,
        detail: 0.99, section: 0.98, callout: 0.97, grid: 0.94,
        schedule: 0.92, element: 0.9, excerpt: 0.78, mark: 0.7, size: 0.55,
      };
      const cleanTok = (s: any): string => String(s || "").trim().toUpperCase();
      const isGenericExcerpt = (t: string) => !t || t.length < 4 || /^(REBAR|BARS?|TYPICAL|VERTICAL|CONT|REINFORCEMENT|NOTE|SHEET|PAGE|FROM|LOOK)$/i.test(t);
      const buildCandidates = (it: any): Array<{ text: string; kind: AnchorKind }> => {
        const meta = inferQaAnchorMeta(it.description, it.source_excerpt, it.source_sheet);
        const out: Array<{ text: string; kind: AnchorKind }> = [];
        const push = (raw: any, kind: AnchorKind) => {
          const t = cleanTok(raw);
          if (!t || isPageTag(t) || isGenericExcerpt(t)) return;
          if (out.some((c) => c.text === t)) return;
          out.push({ text: t, kind });
        };
        push(meta.detail_reference, "detail");
        push(meta.section_reference, "section");
        push(meta.element_id, "element_id");
        push(meta.callout_tag, "callout");
        push(meta.grid_reference, "grid");
        push(meta.schedule_row_identity, "schedule");
        push(meta.element_reference, "element");
        // Excerpt tokens: short, distinctive words/numbers
        const excerpt = String(it.source_excerpt || "").toUpperCase();
        for (const tok of excerpt.split(/[^A-Z0-9#@.\-]+/).filter((w) => w.length >= 5).slice(0, 4)) {
          push(tok, "excerpt");
        }
        const desc = String(it.description || "").toUpperCase();
        const markMatch = desc.match(/\b(BS\d+|BS-\d+|F\d+|FW\d+|W\d+|HKP\d+|EQP\d+|GB\d+|B\d+|S-\d+|PC\d+)\b/);
        if (markMatch) push(markMatch[1], "mark");
        const sz = cleanTok(it.bar_size);
        if (sz) push(sz, "size");
        return out;
      };
      for (const it of items) {
        if (pages.length === 0) continue;
        const cands = buildCandidates(it);
        let chosen: { page: number; text: string; kind: AnchorKind } | null = null;
        for (const c of cands) {
          const hit = pages.find((p) => p.text.includes(c.text));
          if (hit) { chosen = { page: hit.page_number, text: c.text, kind: c.kind }; break; }
        }
        if (chosen) {
          it._page_number = chosen.page;
          it._anchor_text = chosen.text;
          it._anchor_kind = chosen.kind;
          const baseScore = KIND_SCORE[chosen.kind];
          it._anchor_confidence = baseScore;
          // Only the strong object-level kinds get "exact"; everything else
          // is honestly labeled approximate so the viewer cannot draw a
          // precise-looking box on weak evidence.
          it._anchor_mode = baseScore >= 0.9 ? "exact" : "approximate";
        } else {
          it._anchor_mode = "unavailable";
          it._anchor_confidence = 0;
        }
      }
    }

    // Weight validation gate — flag outliers
    const totalAiWeight = items.reduce((s: number, i: any) => s + (Number(i.total_weight) || 0), 0);
    const segType = segment.segment_type;
    const weightLimits: Record<string, number> = {
      footing: 5000, pier: 3000, slab: 15000, wall: 8000, beam: 5000, column: 3000,
      stair: 2000, pit: 2000, curb: 1000, retaining_wall: 10000, miscellaneous: 10000,
    };
    const maxWeight = weightLimits[segType] || 15000;
    if (totalAiWeight > maxWeight) {
      console.warn(`[weight-gate] AI estimated ${totalAiWeight.toFixed(0)}kg for ${segType} segment "${segment.name}" — exceeds ${maxWeight}kg limit. Flagging low confidence.`);
      // Scale down confidence for all items to flag as suspicious
      items.forEach((item: any) => { item.confidence = Math.min(item.confidence || 0.5, 0.4); });
    }

    // Per-row provenance: prefer the file the model cited via source_sheet,
    // falling back to filename-role priority (shop > structural). NEVER pick
    // an architectural file as the source for a quantity row.
    const upperNames = (files as Array<{ id: string; file_name?: string }>).map(
      (f) => ({ id: f.id, name: (f.file_name || "").toUpperCase() })
    );
    const shopFile = upperNames.find((f) => isShopName(f.name));
    const structFile = upperNames.find((f) => isStructName(f.name));
    const defaultSourceId =
      shopFile?.id || structFile?.id ||
      upperNames.find((f) => !isArchName(f.name))?.id || null;

    const resolveRowSource = (it: { source_sheet?: string | null; _page_number?: number | null }): string | null => {
      // 1. Prefer the document_version that produced the OCR page we picked.
      const pn = Number(it._page_number || 0);
      if (pn > 0) {
        const hitPage = relevantPages.find((p) => p.page_number === pn);
        if (hitPage?.document_version_id) {
          const fid = dvToFileId.get(hitPage.document_version_id);
          if (fid) return fid;
        }
      }
      // 2. Fall back to a sheet-tag match against file names.
      const tag = String(it.source_sheet || "").toUpperCase().trim();
      if (tag) {
        const hit = upperNames.find((f) => f.name.includes(tag));
        if (hit && !isArchName(hit.name)) return hit.id;
      }
      // 3. No reliable evidence — return null so QA does not present an unrelated
      // (often Page 1 cover) sheet as the source of an unresolved row.
      return null;
    };

    // Insert items into estimate_items
    const rows = items.map((item: any) => {
      const hasAssumption = !!(item._derivation || item._missing_refs?.length);
      const citationMissing = hasAssumption && !item.authority_section && !item.authority_quote;
      const qaAnchor = inferQaAnchorMeta(item.description, item.source_excerpt, item.source_sheet);
      // Confidence ceiling for AI-only rows: if there's no anchor (no page,
      // no bar-list match, no resolved geometry), cap at 0.6 so downstream
      // approval gates can flag it. Matches the auto-bar-schedule rule.
      const hasAnchor = !!(item._page_number || item._anchor_text || item._anchor_kind);
      const aiOnly = !hasAnchor && (item._geometry_status === "unresolved" || !item._geometry_status);
      const cappedItemConf = aiOnly
        ? Math.min(Number(item.confidence) || 0, 0.6)
        : Math.min(1, Math.max(0, Number(item.confidence) || 0));
      // Tiered waste factor by bar size / item type.
      // Reads from standards_profiles.waste_factors (jsonb) when present;
      // defaults match RSIC industry norms: small ≤#6 → 3%, large ≥#7 → 5%,
      // stirrups/ties → 8%. Falls back to legacy flat 1.05 if profile missing.
      const wf = (standard?.waste_factors as any) || { small: 1.03, large: 1.05, stirrup: 1.08 };
      const sizeStr = String(item.bar_size || "").toUpperCase();
      const isStirrup = /STIRRUP|TIE|HOOP|SPIRAL/i.test(String(item.description || ""));
      // Imperial #N or metric XXM size parsing.
      const imp = sizeStr.match(/#\s*(\d+)/);
      const met = sizeStr.match(/(\d+)\s*M\b/);
      const sizeNumber = imp ? Number(imp[1]) : met ? Math.round(Number(met[1]) / 3.18) : 0; // crude metric→# equiv
      let wasteTier: "small" | "large" | "stirrup" = "small";
      if (isStirrup) wasteTier = "stirrup";
      else if (sizeNumber >= 7) wasteTier = "large";
      const wasteFactor = Math.min(1.20, Math.max(1.00, Number(wf[wasteTier]) || 1.05));
      return {
      segment_id,
      project_id,
      user_id: user.id,
      description: String(item.description || "").slice(0, 500),
      bar_size: String(item.bar_size || "").slice(0, 20),
      quantity_count: Math.max(0, Math.round(Number(item.quantity_count) || 0)),
      total_length: Math.max(0, Number(item.total_length) || 0),
      total_weight: Math.max(0, Number(item.total_weight) || 0),
      confidence: cappedItemConf,
      item_type: String(item.item_type || "rebar"),
      waste_factor: wasteFactor,
      status: (item._geometry_status === "unresolved" || citationMissing) ? "unresolved" : "draft",
      source_file_id: resolveRowSource(item),
      assumptions_json: {
        geometry_status: item._geometry_status || "unresolved",
        missing_refs: item._missing_refs || [],
        derivation: item._derivation || null,
        page_number: item._page_number || null,
        source_sheet: item.source_sheet || null,
        source_excerpt: item.source_excerpt || null,
        detail_reference: qaAnchor.detail_reference,
        section_reference: qaAnchor.section_reference,
        callout_tag: qaAnchor.callout_tag,
        element_id: qaAnchor.element_id,
        footing_id: qaAnchor.footing_id,
        wall_id: qaAnchor.wall_id,
        pad_id: qaAnchor.pad_id,
        slab_zone_id: qaAnchor.slab_zone_id,
        grid_reference: qaAnchor.grid_reference,
        zone_reference: qaAnchor.zone_reference,
        element_reference: qaAnchor.element_reference,
        schedule_row_identity: qaAnchor.schedule_row_identity,
        anchor_text: item._anchor_text || null,
        anchor_kind: item._anchor_kind || null,
        anchor_confidence: typeof item._anchor_confidence === "number" ? item._anchor_confidence : null,
        anchor_mode: item._anchor_mode || (item._page_number ? "approximate" : "unavailable"),
        wall_geometry: item._wall_geometry || null,
        linear_geometry: item._linear_geometry || null,
        authority_document: "Manual-Standard-Practice-2018",
        authority_section: item.authority_section || null,
        authority_page: item.authority_page || null,
        authority_quote: item.authority_quote || null,
        assumption_rule_id: item.assumption_rule_id || null,
        citation_missing: citationMissing,
        waste_tier: wasteTier,
        waste_factor_source: standard?.waste_factors ? "standards_profile" : "rsic_default",
      },
    };
    });

    // De-dup gate: collapse rows on (normalized description, bar_size) keeping highest-confidence,
    // and skip rows that already exist for this segment.
    // Replace stale auto-generated rows for this segment so re-runs reflect
    // the new estimator output instead of accumulating duplicates.
    const { error: cleanupErr } = await supabase
      .from("estimate_items")
      .delete()
      .eq("segment_id", segment_id)
      .in("status", ["unresolved", "draft"]);
    if (cleanupErr) console.warn("[auto-estimate] cleanup of stale rows failed:", cleanupErr.message);
    // Also clear unresolved-geometry validation issues for this segment.
    const { error: viCleanupErr } = await supabase
      .from("validation_issues")
      .delete()
      .eq("segment_id", segment_id)
      .eq("issue_type", "unresolved_geometry");
    if (viCleanupErr) console.warn("[auto-estimate] cleanup of stale validation issues failed:", viCleanupErr.message);
    // Refresh existingKeys so we don't accidentally still de-dup against the
    // rows we just deleted.
    existingKeys.clear();
    const dedupMap = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const k = normKey(r.description, r.bar_size);
      if (existingKeys.has(k)) continue;
      const prev = dedupMap.get(k);
      if (!prev || (r.confidence as number) > (prev.confidence as number)) dedupMap.set(k, r);
    }
    const dedupedRows = Array.from(dedupMap.values());

    // ───────────────────────────────────────────────────────────────
    // OUTLIER GUARD (MAD check on length-per-piece, grouped by bar_size)
    // Catches OCR errors like "10'-0"" parsed as "100'-0"" inflating a
    // whole segment. Threshold: |x - median| / MAD > 3.5  (≈ 3σ).
    // Flagged rows: status='unresolved', confidence capped 0.3,
    // and a validation_issue is queued (severity: error).
    // ───────────────────────────────────────────────────────────────
    const outlierFlags = new Map<number, { lpp: number; median: number; mad: number; bar_size: string }>();
    {
      const bySize = new Map<string, Array<{ idx: number; lpp: number }>>();
      dedupedRows.forEach((r: any, idx: number) => {
        const qty = Number(r.quantity_count) || 0;
        const len = Number(r.total_length) || 0;
        if (qty <= 0 || len <= 0) return;
        const size = String(r.bar_size || "").toUpperCase();
        if (!size) return;
        const lpp = len / qty;
        if (!isFinite(lpp) || lpp <= 0) return;
        const arr = bySize.get(size) || [];
        arr.push({ idx, lpp });
        bySize.set(size, arr);
      });
      for (const [size, arr] of bySize) {
        if (arr.length < 4) continue; // need a meaningful sample
        const sorted = [...arr].map((a) => a.lpp).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const devs = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
        const mad = devs[Math.floor(devs.length / 2)] || (median * 0.05);
        if (mad <= 0) continue;
        for (const { idx, lpp } of arr) {
          const score = Math.abs(lpp - median) / mad;
          if (score > 3.5) outlierFlags.set(idx, { lpp, median, mad, bar_size: size });
        }
      }
      if (outlierFlags.size > 0) {
        for (const [idx, info] of outlierFlags) {
          const row: any = dedupedRows[idx];
          row.status = "unresolved";
          row.confidence = Math.min(Number(row.confidence) || 0, 0.3);
          row.assumptions_json = {
            ...(row.assumptions_json || {}),
            outlier_flag: {
              kind: "length_per_piece_mad",
              length_per_piece_m: Math.round(info.lpp * 100) / 100,
              median_m: Math.round(info.median * 100) / 100,
              mad_m: Math.round(info.mad * 100) / 100,
              bar_size: info.bar_size,
            },
          };
        }
        console.warn(`[auto-estimate] outlier-guard flagged ${outlierFlags.size} row(s) for segment ${segment_id}`);
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("estimate_items")
      .insert(dedupedRows)
      .select("id");

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to save items" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Queue validation_issues for every outlier-flagged row.
    if (outlierFlags.size > 0 && inserted && inserted.length === dedupedRows.length) {
      const outlierIssues: any[] = [];
      for (const [idx, info] of outlierFlags) {
        const row: any = dedupedRows[idx];
        outlierIssues.push({
          user_id: user.id,
          project_id,
          segment_id,
          issue_type: "outlier_length",
          severity: "error",
          title: `Outlier cut length on ${info.bar_size}`,
          description: `Length-per-piece ${info.lpp.toFixed(2)}m deviates from segment median ${info.median.toFixed(2)}m (MAD=${info.mad.toFixed(2)}m). Likely OCR misread (e.g. "10'-0"" → "100'-0""). Verify on source drawing before approval.`,
          status: "open",
          source_refs: [{ estimate_item_id: inserted[idx]?.id, source_sheet: row.assumptions_json?.source_sheet || null, page_number: row.assumptions_json?.page_number || null }],
        });
      }
      const { error: oiErr } = await supabase.from("validation_issues").insert(outlierIssues);
      if (oiErr) console.warn("[auto-estimate] outlier issue insert failed:", oiErr.message);
    }

    // Open a validation_issue for every unresolved row so the QA queue surfaces them.
    const unresolvedIssues = dedupedRows
      .map((r, idx) => ({ r, id: inserted?.[idx]?.id }))
      .filter((x) => {
        const aj = (x.r as any).assumptions_json || {};
        return ["unresolved", "partial"].includes(String(aj.geometry_status || ""))
          && Array.isArray(aj.missing_refs)
          && aj.missing_refs.length > 0;
      })
      .map((x) => {
        const aj: any = (x.r as any).assumptions_json || {};
        const sheet = aj.sheet || aj.sheet_id || aj.source_sheet || null;
        const detail = aj.detail || aj.detail_reference || null;
        const section = aj.section || aj.section_reference || null;
        const grid = aj.grid || aj.grid_reference || null;
        const zone = aj.zone || aj.zone_reference || aj.area || null;
        const calloutTag = aj.callout_tag || null;
        const elementId = aj.element_id || null;
        const scheduleRowIdentity = aj.schedule_row_identity || null;
        const objectIdentity = pickObjectIdentity({
          element_id: elementId,
          callout_tag: calloutTag,
          schedule_row_identity: scheduleRowIdentity,
          detail_reference: detail,
          grid_reference: grid,
          section_reference: section,
        });
        const element = aj.element || aj.element_reference || aj.mark || aj.callout
          || aj.wall_name || aj.footing_name || aj.pad_name || null;
        const excerpt = aj.excerpt || aj.source_excerpt || null;
        const locParts: string[] = [];
        if (sheet) locParts.push(`Sheet ${sheet}`);
        if (aj.page_number) locParts.push(`Page ${aj.page_number}`);
        if (detail) locParts.push(`Detail ${detail}`);
        if (section) locParts.push(`Section ${section}`);
        if (objectIdentity && objectIdentity !== detail && objectIdentity !== section) locParts.push(objectIdentity);
        if (grid) locParts.push(`Grid ${grid}`);
        if (zone) locParts.push(String(zone));
        if (element) locParts.push(String(element));
        if (scheduleRowIdentity && scheduleRowIdentity !== element) locParts.push(String(scheduleRowIdentity));
        const locLabel = locParts.join(" · ");
        // Build a raw-input ask: never request derived values (totals, perimeter, qty).
        // Estimator enters drawing-direct dimensions; the system does the math.
        const elClass = classifyElementForAsk(`${element || ""} ${x.r.description || ""}`);
        const noun = elementNounForAsk(elClass);
        const phrases: string[] = [];
        for (const tok of (aj.missing_refs || [])) {
          const p = rawInputPhraseForAsk(String(tok), elClass);
          if (p && !phrases.includes(p)) phrases.push(p);
        }
        if (phrases.length === 0) phrases.push(defaultRawInputForAsk(elClass));
        const inputList = phrases.length === 1
          ? phrases[0]
          : phrases.slice(0, -1).join(", ") + ", and " + phrases[phrases.length - 1];
        const lookAt = locLabel || (aj.page_number ? `Page ${aj.page_number}` : "the drawing");
        const findPart = objectIdentity
          ? `${noun} ${objectIdentity}`
          : element && !isPageTag(element)
            ? `the ${noun} marked "${element}"`
            : (excerpt ? `the ${noun} for "${String(excerpt).slice(0, 80)}"` : `the ${noun}`);
        const baseTitle = `${noun} — enter drawing dimensions`;
        const wallGeo = aj.wall_geometry || null;
        const linearGeo = aj.linear_geometry || null;
        const wallFoundParts = wallGeo && (wallGeo.lengthMm || wallGeo.heightMm)
          ? [
            wallGeo.lengthMm ? `wall length ${Math.round(wallGeo.lengthMm)}mm` : null,
            wallGeo.heightMm ? `wall height ${Math.round(wallGeo.heightMm)}mm` : null,
            wallGeo.sheetTag || wallGeo.pageNumber ? `from ${wallGeo.sheetTag || `page ${wallGeo.pageNumber}`}` : null,
          ].filter(Boolean).join("; ")
          : null;
        const linearFoundParts = linearGeo && (linearGeo.barCallout || linearGeo.lengthMm || linearGeo.heightMm)
          ? [
            linearGeo.objectLabel || noun,
            linearGeo.barCallout ? `bar callout ${linearGeo.barCallout}` : null,
            linearGeo.lengthMm ? `length ${Math.round(linearGeo.lengthMm)}mm` : null,
            linearGeo.heightMm ? `height ${Math.round(linearGeo.heightMm)}mm` : null,
          ].filter(Boolean).join("; ")
          : null;
        const foundPrefix = wallFoundParts
          ? `Found ${wallFoundParts}. Evidence quality: ${wallGeo.confidence}; ${wallGeo.reason} `
          : linearFoundParts
            ? `Found ${linearFoundParts}. Evidence quality: ${linearGeo.confidence}; ${linearGeo.reason} `
            : "";
        const baseDesc = `${foundPrefix}Look at ${lookAt}. Find ${findPart}. Enter ${inputList} from the drawing.`;
        return ({
        user_id: user.id,
        project_id,
        segment_id,
        source_file_id: (x.r as any).source_file_id || null,
        issue_type: "unresolved_geometry",
        severity: (x.r as any).assumptions_json?.geometry_status === "partial" ? "warning" : "error",
        title: locLabel ? `${locLabel}: ${baseTitle}` : baseTitle,
        description: baseDesc,
        sheet_id: sheet,
        status: "open",
        source_refs: [{
          estimate_item_id: x.id,
          missing: aj.missing_refs || [],
          page_number: aj.page_number || null,
          sheet,
          detail,
          section,
          callout_tag: calloutTag,
          element_id: elementId,
          footing_id: aj.footing_id || null,
          wall_id: aj.wall_id || null,
          pad_id: aj.pad_id || null,
          slab_zone_id: aj.slab_zone_id || null,
          grid,
          zone,
          element,
          schedule_row_identity: scheduleRowIdentity,
          excerpt,
          bar_size: (x.r as any).bar_size || null,
          description: (x.r as any).description || null,
          anchor_text: aj.anchor_text || null,
          anchor_kind: aj.anchor_kind || null,
          anchor_confidence: typeof aj.anchor_confidence === "number" ? aj.anchor_confidence : null,
          anchor_mode: aj.anchor_mode || (aj.page_number ? "approximate" : "unavailable"),
          wall_geometry: wallGeo,
          linear_geometry: linearGeo,
        }],
      });
      });
    if (unresolvedIssues.length > 0) {
      const { error: viErr } = await supabase.from("validation_issues").insert(unresolvedIssues);
      if (viErr) console.warn("validation_issues insert failed:", viErr.message);
    }

    // Update segment confidence to avg of its estimate items (deduped set)
    const avgConf = dedupedRows.reduce((s, r) => s + (r.confidence as number), 0) / (dedupedRows.length || 1);
    await supabase.from("segments").update({ confidence: Math.round(avgConf * 100) / 100 }).eq("id", segment_id);

    // Audit log
    await supabase.from("audit_events").insert({
      user_id: user.id,
      project_id,
      segment_id,
      action: "auto_estimated",
      entity_type: "segment",
      entity_id: segment_id,
      metadata: { items_created: inserted?.length || 0 },
    });

    return new Response(JSON.stringify({
      success: true,
      items_created: inserted?.length || 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auto-estimate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
