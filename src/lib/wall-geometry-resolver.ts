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

export interface LinearElementGeometryEvidence {
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

export function isScaleMeasurableLinearElement(text?: string | null): boolean {
  return /\b(brick\s+ledge|ledge|curb|slab\s+edge|pad|foundation\s+wall|frost\s+wall|wall)\b/i.test(String(text || ""));
}

export function extractLinearBarCallout(text: string): Pick<LinearElementGeometryEvidence, "barCallout" | "spacingMm" | "orientation"> {
  const normalized = text.replace(/\s+/g, " ");
  const verbose = normalized.match(/\b(10M|15M|20M|25M|30M|35M)\s+(?:(vertical|horizontal)\s+)?bars?\s*@\s*(\d+(?:\.\d+)?)\s*mm\s*(?:\([^)]*\)\s*)?O\.?\s*C\.?(?:\s*(typical|staggered))?/i);
  if (verbose) {
    const orientation = verbose[2]?.toLowerCase() === "vertical" || verbose[2]?.toLowerCase() === "horizontal"
      ? verbose[2].toLowerCase() as "vertical" | "horizontal"
      : "unknown";
    return {
      barCallout: [
        verbose[1].toUpperCase(),
        orientation !== "unknown" ? orientation : null,
        "bars @",
        `${Number(verbose[3])}mm`,
        "O.C.",
        verbose[4]?.toLowerCase(),
      ].filter(Boolean).join(" "),
      spacingMm: Number(verbose[3]),
      orientation,
    };
  }
  const compact = normalized.match(/\b(10M|15M|20M|25M|30M|35M)\s*@\s*(\d+(?:\.\d+)?)\s*mm\s*(?:\([^)]*\)\s*)?O\.?\s*C\.?(?:\s*(vertical|horizontal|typical|staggered))?/i);
  if (!compact) return { barCallout: null, spacingMm: null, orientation: "unknown" };
  const tail = compact[3]?.toLowerCase() || "";
  return {
    barCallout: [
      compact[1].toUpperCase(),
      "@",
      `${Number(compact[2])}mm`,
      "O.C.",
      tail || null,
    ].filter(Boolean).join(" "),
    spacingMm: Number(compact[2]),
    orientation: tail === "vertical" || tail === "horizontal" ? tail : "unknown",
  };
}

export function resolveLinearElementGeometryFromPages(params: {
  pages: WallGeometryPage[];
  objectText?: string | null;
  calloutText?: string | null;
  sourceSheet?: string | null;
}): LinearElementGeometryEvidence {
  const objectLabel = inferLinearObject(params.objectText || params.calloutText || "");
  const callout = extractLinearBarCallout(`${params.objectText || ""} ${params.calloutText || ""}`);
  const candidates = params.pages
    .filter((page) => isStructuralPage(page))
    .map((page) => ({ page, score: scoreLinearPage(page, params, objectLabel) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { page } of candidates) {
    const text = page.rawText.replace(/\s+/g, " ");
    const dimensions = extractLinearDimensions(text, objectLabel);
    const pageCallout = callout.barCallout ? callout : extractLinearBarCallout(text);
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
        excerpt: dimensions.excerpt || snippet(text),
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
        barCallout: callout.barCallout,
        spacingMm: callout.spacingMm,
        orientation: callout.orientation,
        method: "scale_measurement",
        confidence: callout.barCallout && measured.heightMm ? "high" : "low",
        needsConfirmation: !(callout.barCallout && measured.heightMm),
        pageNumber: page.pageNumber,
        sheetTag: page.sheetTag,
        scaleRaw: page.scaleRaw,
        excerpt: snippet(page.rawText),
        reason: "Measured element bbox using sheet scale.",
      };
    }
  }

  return {
    objectLabel,
    lengthMm: null,
    heightMm: null,
    barCallout: callout.barCallout,
    spacingMm: callout.spacingMm,
    orientation: callout.orientation,
    method: "not_found",
    confidence: callout.barCallout ? "medium" : "low",
    needsConfirmation: true,
    reason: callout.barCallout ? "Found bar callout, but no reliable element dimensions were found." : "No reliable linear element geometry was found.",
  };
}

function isStructuralPage(page: WallGeometryPage): boolean {
  const hay = `${page.discipline || ""} ${page.sheetTag || ""} ${page.rawText.slice(0, 500)}`.toLowerCase();
  return !/\barchitectural\b|^a[-\s]?\d/.test(hay)
    && /\bstruct|^s[-\s]?\d|foundation|wall|concrete|reinforc/i.test(hay);
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
  return { lengthMm, heightMm, method: "explicit_text" as const, excerpt: lengthMm || heightMm ? snippet(text) : null };
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

function snippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}
