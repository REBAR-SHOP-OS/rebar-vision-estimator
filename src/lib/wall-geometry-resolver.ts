export interface WallGeometryPage {
  pageNumber: number;
  sheetTag?: string | null;
  rawText: string;
  discipline?: string | null;
  scaleRaw?: string | null;
  scaleRatio?: number | null;
  bbox?: [number, number, number, number] | null;
}

export interface WallGeometryEvidence {
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

export function parseScaleRatio(scaleRaw?: string | null): number | null {
  const raw = String(scaleRaw || "").trim();
  const ratio = raw.match(/1\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (ratio) return Number(ratio[1]);
  const metric = raw.match(/(\d+(?:\.\d+)?)\s*mm\s*=\s*(\d+(?:\.\d+)?)\s*m/i);
  if (metric) return (Number(metric[2]) * 1000) / Number(metric[1]);
  return null;
}

export function resolveWallGeometryFromPages(params: {
  pages: WallGeometryPage[];
  objectText?: string | null;
  calloutText?: string | null;
  sourceSheet?: string | null;
}): WallGeometryEvidence {
  const candidates = params.pages
    .filter((page) => isStructuralPage(page) && /wall|foundation/i.test(page.rawText))
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
        excerpt: snippet(page.rawText),
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

function isStructuralPage(page: WallGeometryPage): boolean {
  const hay = `${page.discipline || ""} ${page.sheetTag || ""} ${page.rawText.slice(0, 500)}`.toLowerCase();
  return !/\barchitectural\b|^a[-\s]?\d/.test(hay)
    && /\bstruct|^s[-\s]?\d|foundation|wall|concrete|reinforc/i.test(hay);
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
  if (length || height) {
    return { lengthMm: length, heightMm: height, method: "explicit_text", excerpt: snippet(normalized) };
  }

  const schedule = normalized.match(/\b(?:W\d+|FW\d+|FOUNDATION WALL|WALL)[^.\n]{0,80}?(\d{4,6})\s*(?:mm)?\s*[xX]\s*(\d{3,5})\s*(?:mm)?/i);
  if (schedule) {
    const a = Number(schedule[1]);
    const b = Number(schedule[2]);
    return {
      lengthMm: Math.max(a, b),
      heightMm: Math.min(a, b),
      method: "schedule",
      excerpt: schedule[0].trim(),
    };
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

function snippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}
