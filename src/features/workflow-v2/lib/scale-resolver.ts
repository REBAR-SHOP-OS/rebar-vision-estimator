/**
 * Layered drawing-scale resolver.
 *
 * Goal: convert a sheet's text/geometry hints into pixels-per-foot so every
 * downstream segment can be measured in real-world units instead of pixels.
 *
 * Layers (highest confidence first):
 *   A. Title-block / viewport scale text  ("SCALE: 1/8\" = 1'-0\"" or "1:50")
 *   B. Dimension annotation pinned to a measured pixel length (e.g. 12'-6")
 *   C. Known-object fallback (door = 36 in, parking stall = 9 ft)
 *   user. Estimator override
 */

export type CalibrationSource =
  | "title_block"
  | "dimension"
  | "auto_dimension"
  | "grid_dimension"
  | "known_object"
  | "user";

export type CalibrationConfidence = "high" | "medium" | "low" | "user";

export interface DetailOverride {
  tag: string;
  scaleText: string;
  pixelsPerFoot: number;
  nts: boolean;
}

export interface Calibration {
  source: CalibrationSource;
  scaleText?: string;
  pixelsPerFoot: number;
  confidence: CalibrationConfidence;
  method: string;
  detailOverrides?: DetailOverride[];
}

export interface DimensionHint {
  /** Annotation text that names a real distance, e.g. "12'-6\"" or "150 mm". */
  text: string;
  /** Pixel length of the line/extension the annotation refers to. */
  pixelLength: number;
}

export interface KnownObjectHint {
  /** Label, e.g. "door", "parking stall". */
  label: string;
  /** Real-world length in feet. */
  realFeet: number;
  /** Pixel length detected for the object. */
  pixelLength: number;
}

export interface SheetScaleInputs {
  rawText?: string | null;
  dimensions?: DimensionHint[];
  knownObjects?: KnownObjectHint[];
  pageWidthPx?: number;
}

const FT_PER_IN = 1 / 12;

/** "1/8\" = 1'-0\"" → 1/8 inch on paper = 1 ft real. */
const ARCH_SCALE_RE =
  /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*"?\s*=\s*1\s*'?\s*-?\s*0?\s*"?/;
/** "1:50" or "1 : 100" — engineering ratio (1 paper unit = N real units). */
const RATIO_RE = /\b1\s*:\s*(\d+(?:\.\d+)?)\b/;
/** Bare textual scale prefix: "SCALE: NTS" / "Scale 1/4 = 1'-0\"". */
const SCALE_PREFIX_RE = /\bscale\b/i;

/** Parse imperial dimension annotations like 12'-6", 8', 6". Returns feet. */
export function parseImperialFeet(text: string): number | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  // 12'-6" or 12' 6"
  const both = cleaned.match(/(\d+(?:\.\d+)?)\s*'\s*[-\s]?\s*(\d+(?:\.\d+)?)\s*"/);
  if (both) return Number(both[1]) + Number(both[2]) * FT_PER_IN;
  const feetOnly = cleaned.match(/(\d+(?:\.\d+)?)\s*'/);
  if (feetOnly) return Number(feetOnly[1]);
  const inchOnly = cleaned.match(/(\d+(?:\.\d+)?)\s*"/);
  if (inchOnly) return Number(inchOnly[1]) * FT_PER_IN;
  // metric → feet
  const metric = cleaned.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i);
  if (metric) {
    const n = Number(metric[1]);
    const unit = metric[2].toLowerCase();
    const meters = unit === "mm" ? n / 1000 : unit === "cm" ? n / 100 : n;
    return meters * 3.28084;
  }
  return null;
}

/** Layer A: scrape the sheet text for an explicit scale statement. */
export function tryTitleBlockText(rawText?: string | null): Calibration | null {
  if (!rawText) return null;
  const text = rawText.replace(/\s+/g, " ");
  if (!SCALE_PREFIX_RE.test(text) && !ARCH_SCALE_RE.test(text) && !RATIO_RE.test(text)) {
    return null;
  }
  const arch = text.match(ARCH_SCALE_RE);
  if (arch) {
    const inchesOnPaper = Number(arch[1]) / Number(arch[2]);
    if (inchesOnPaper > 0) {
      // 1 ft real -> inchesOnPaper inches paper.
      // Most US drawings render at 96 DPI when rasterised. Use that as the
      // canonical assumption — estimators can override per-sheet if exporters
      // use a different DPI.
      const pixelsPerFoot = inchesOnPaper * 96;
      return {
        source: "title_block",
        scaleText: arch[0].trim(),
        pixelsPerFoot,
        confidence: "high",
        method: `Architectural scale ${arch[0].trim()} @ 96 DPI`,
      };
    }
  }
  const ratio = text.match(RATIO_RE);
  if (ratio) {
    const denom = Number(ratio[1]);
    if (denom > 0) {
      // 1:50 means 1 mm paper = 50 mm real.
      // At 96 DPI, 1 inch = 96 px → 1 mm ≈ 3.7795 px.
      const mmPerFootReal = 304.8;
      const paperMmPerFoot = mmPerFootReal / denom;
      const pixelsPerFoot = paperMmPerFoot * 3.7795275591;
      return {
        source: "title_block",
        scaleText: `1:${denom}`,
        pixelsPerFoot,
        confidence: "high",
        method: `Engineering ratio 1:${denom} @ 96 DPI`,
      };
    }
  }
  // Found "SCALE" but couldn't parse a value — surface as low-confidence.
  return {
    source: "title_block",
    scaleText: text.match(/scale[^.\n]{0,30}/i)?.[0]?.trim(),
    pixelsPerFoot: 0,
    confidence: "low",
    method: "SCALE keyword found but value unparseable",
  };
}

/** Layer B: derive pixels-per-foot from a dimension annotation + measured pixels. */
export function tryDimensionAnnotation(
  dims?: DimensionHint[],
): Calibration | null {
  if (!dims || dims.length === 0) return null;
  const samples: { ppf: number; text: string }[] = [];
  for (const d of dims) {
    if (!Number.isFinite(d.pixelLength) || d.pixelLength <= 0) continue;
    const realFt = parseImperialFeet(d.text);
    if (!realFt || realFt <= 0) continue;
    samples.push({ ppf: d.pixelLength / realFt, text: d.text });
  }
  if (samples.length === 0) return null;
  // Use median to stay robust against one mis-measured extension line.
  samples.sort((a, b) => a.ppf - b.ppf);
  const median = samples[Math.floor(samples.length / 2)];
  return {
    source: "dimension",
    scaleText: median.text,
    pixelsPerFoot: median.ppf,
    confidence: samples.length >= 3 ? "medium" : "low",
    method: `Median of ${samples.length} dimension annotation(s)`,
  };
}

/** Layer C: weakest fallback — a known object's real size. */
export function tryKnownObject(
  objs?: KnownObjectHint[],
): Calibration | null {
  if (!objs || objs.length === 0) return null;
  const best = objs.find(
    (o) => o.realFeet > 0 && Number.isFinite(o.pixelLength) && o.pixelLength > 0,
  );
  if (!best) return null;
  return {
    source: "known_object",
    scaleText: `${best.label} ≈ ${best.realFeet} ft`,
    pixelsPerFoot: best.pixelLength / best.realFeet,
    confidence: "low",
    method: `Known object: ${best.label}`,
  };
}

/**
 * Layer B2 (text-only fallback): no scale text, no measured pixel dimensions.
 * Scrape any imperial / metric size annotation from the raw OCR text and infer
 * px/ft by assuming the longest documented run roughly spans the drawable
 * width of an ANSI D sheet rasterised at 96 DPI (~3264 px ≈ 34 in). This is a
 * trust-first proposal — always returned as low confidence so the estimator
 * must accept it before the calibration gate unlocks.
 */
export function tryAutoDimensionFromText(rawText?: string | null): Calibration | null {
  if (!rawText) return null;
  const text = rawText.replace(/\s+/g, " ");
  const matches: { feet: number; text: string }[] = [];
  const patterns: RegExp[] = [
    /(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"/g,   // 12'-6"
    /(\d+(?:\.\d+)?)\s*'(?!\s*\d)/g,                       // 12'
    /(\d+(?:\.\d+)?)\s*"/g,                                // 6"
    /(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/gi,                     // 150 mm / 3 m
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const ft = parseImperialFeet(m[0]);
      if (ft && ft >= 0.5 && ft <= 200) matches.push({ feet: ft, text: m[0].trim() });
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.feet - b.feet);
  const median = matches[Math.floor(matches.length / 2)];
  const ANSI_D_WIDTH_PX = 3264; // 34 in @ 96 DPI
  let pixelsPerFoot = ANSI_D_WIDTH_PX / Math.max(median.feet, 0.5);
  pixelsPerFoot = Math.min(384, Math.max(16, pixelsPerFoot));
  return {
    source: "auto_dimension",
    scaleText: median.text,
    pixelsPerFoot,
    confidence: "low",
    method: `Auto-inferred from ${matches.length} dimension annotation(s) — verify before takeoff`,
  };
}

/** Convert a "1:N" engineering ratio into pixels-per-foot at 96 DPI. */
function pixelsPerFootFromRatio(denom: number): number {
  if (!denom || denom <= 0) return 0;
  const mmPerFootReal = 304.8;
  const paperMmPerFoot = mmPerFootReal / denom;
  return paperMmPerFoot * 3.7795275591;
}

/**
 * Layer A2: grid-spacing inference. Looks for grid labels and adjacent
 * 4–5 digit metric distance numbers (e.g. "Grid 1 ... 6133 ... Grid 2") and
 * derives px/ft using the page's drawable width as the projection target.
 */
export function tryGridDimension(rawText?: string | null, pageWidthPx?: number): Calibration | null {
  if (!rawText) return null;
  const text = rawText.replace(/\s+/g, " ");
  const gridRe = /\b(?:GRID|GRIDLINE|GL)\s*[:#]?\s*([0-9A-Z]{1,3})\b/gi;
  const positions: { idx: number; label: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = gridRe.exec(text)) !== null) positions.push({ idx: m.index, label: m[1].toUpperCase() });
  if (positions.length < 2) return null;
  const samplesMm: number[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    const a = positions[i];
    const b = positions[i + 1];
    const window = text.slice(a.idx, Math.min(b.idx + 80, text.length));
    const numRe = /(?<![\d.])(\d{4,5})(?![\d.])/g;
    let nm: RegExpExecArray | null;
    while ((nm = numRe.exec(window)) !== null) {
      const n = Number(nm[1]);
      if (n >= 1500 && n <= 60000) { samplesMm.push(n); break; }
    }
  }
  if (samplesMm.length === 0) return null;
  samplesMm.sort((a, b) => a - b);
  const medianMm = samplesMm[Math.floor(samplesMm.length / 2)];
  const medianFt = (medianMm / 1000) * 3.28084;
  if (medianFt <= 0) return null;

  // Estimate the projected pixel-span of the median grid bay.
  // Default: assume the full set of grids spans ~85% of the drawable page width.
  const drawableWidthPx = (pageWidthPx && pageWidthPx > 0 ? pageWidthPx : 3264) * 0.85;
  const totalMm = samplesMm.reduce((s, v) => s + v, 0);
  const totalFt = (totalMm / 1000) * 3.28084;
  const pxPerFootFromTotal = totalFt > 0 ? drawableWidthPx / totalFt : 0;

  // Confidence: high if ≥3 samples and they cluster within 5% of median.
  const within5pct = samplesMm.filter((s) => Math.abs(s - medianMm) / medianMm <= 0.05).length;
  let confidence: CalibrationConfidence = "low";
  if (samplesMm.length >= 3 && within5pct >= 3) confidence = "high";
  else if (samplesMm.length >= 2) confidence = "medium";

  let pixelsPerFoot = pxPerFootFromTotal;
  pixelsPerFoot = Math.min(384, Math.max(16, pixelsPerFoot));
  return {
    source: "grid_dimension",
    scaleText: `${medianMm} mm grid bay`,
    pixelsPerFoot,
    confidence,
    method: `Grid spacing: median ${medianMm} mm across ${samplesMm.length} bay(s)`,
  };
}

/** Detect per-detail scale callouts (e.g. "1/S-6.0  SCALE: 1:25", "DETAIL B  N.T.S."). */
export function tryDetailScales(rawText?: string | null): DetailOverride[] {
  if (!rawText) return [];
  const text = rawText.replace(/\s+/g, " ");
  const out: DetailOverride[] = [];
  const seen = new Set<string>();
  const push = (tag: string, scaleText: string) => {
    const key = `${tag}::${scaleText}`.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    const nts = /N\.?T\.?S\.?/i.test(scaleText);
    let ppf = 0;
    if (!nts) {
      const r = scaleText.match(/1\s*:\s*(\d+)/);
      if (r) ppf = pixelsPerFootFromRatio(Number(r[1]));
      else {
        const arch = scaleText.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*"?\s*=\s*1\s*'/);
        if (arch) ppf = (Number(arch[1]) / Number(arch[2])) * 96;
      }
    }
    out.push({ tag, scaleText, pixelsPerFoot: ppf, nts });
  };
  const reA = /(\b\d+\s*\/\s*[A-Z]-?\d+(?:\.\d+)?)\b[^\n]{0,40}?(?:SCALE\s*[:=]?\s*)?(1\s*:\s*\d+|N\.?T\.?S\.?|\d+\/\d+\s*"?\s*=\s*1\s*')/gi;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(text)) !== null) push(m[1].replace(/\s+/g, ""), m[2].trim());
  const reB = /\bDETAIL\s+([A-Z0-9]{1,4})\b[^\n]{0,40}?(1\s*:\s*\d+|N\.?T\.?S\.?|\d+\/\d+\s*"?\s*=\s*1\s*')/gi;
  while ((m = reB.exec(text)) !== null) push(`DETAIL ${m[1].toUpperCase()}`, m[2].trim());
  return out;
}

/** Try every layer in priority order. */
export function resolveScale(input: SheetScaleInputs): Calibration | null {
  const a = tryTitleBlockText(input.rawText);
  const detailOverrides = tryDetailScales(input.rawText);
  const attach = (cal: Calibration | null): Calibration | null => {
    if (!cal) return null;
    return detailOverrides.length ? { ...cal, detailOverrides } : cal;
  };
  if (a && a.pixelsPerFoot > 0 && a.confidence === "high") return attach(a);
  const grid = tryGridDimension(input.rawText, input.pageWidthPx);
  if (grid && grid.pixelsPerFoot > 0 && (grid.confidence === "high" || grid.confidence === "medium")) return attach(grid);
  const b = tryDimensionAnnotation(input.dimensions);
  if (b && b.pixelsPerFoot > 0) return attach(b);
  const auto = tryAutoDimensionFromText(input.rawText);
  if (auto && auto.pixelsPerFoot > 0) return attach(auto);
  if (grid && grid.pixelsPerFoot > 0) return attach(grid);
  const c = tryKnownObject(input.knownObjects);
  if (c) return attach(c);
  if (a && a.pixelsPerFoot > 0) return attach(a);
  // Last-resort deterministic default: 1/8" = 1'-0" @ 96 DPI = 12 px/ft.
  // Guarantees every sheet has a usable px/ft so the estimator never has to
  // hand-fill values just to unlock the calibration gate.
  return attach({
    source: "auto_dimension",
    pixelsPerFoot: 12,
    confidence: "low",
    method: "Default 1/8\" = 1'-0\" @ 96 DPI (auto-applied — verify if takeoff looks off)",
  });
}

export function realFeetFromPixels(
  pixelLength: number,
  calibration: Pick<Calibration, "pixelsPerFoot">,
): number {
  if (!calibration.pixelsPerFoot || calibration.pixelsPerFoot <= 0) return 0;
  return pixelLength / calibration.pixelsPerFoot;
}

/** Sheet discipline classification. Drives "Structural wins" gating. */
export type Discipline = "Structural" | "Architectural" | "Other";

export interface DisciplinedSheet {
  id: string;
  discipline: Discipline;
  sheetNumber?: string | null;
  pageNumber?: number | null;
}

/**
 * "Structural wins" resolver: returns the calibration that should drive
 * real-world quantities for a given sheet. Structural sheets use their own
 * calibration; Architectural / Other sheets fall back to the nearest
 * Structural sheet (matching sheet-number prefix when possible, otherwise the
 * first available Structural calibration in the project).
 */
export function getAuthoritativeCalibration(
  sheetId: string,
  sheets: DisciplinedSheet[],
  calibrations: Record<string, Calibration>,
): { calibration: Calibration | null; sourceSheetId: string | null } {
  const target = sheets.find((s) => s.id === sheetId);
  if (!target) return { calibration: null, sourceSheetId: null };
  if (target.discipline === "Structural") {
    const c = calibrations[sheetId] || null;
    return { calibration: c, sourceSheetId: c ? sheetId : null };
  }
  const structurals = sheets.filter((s) => s.discipline === "Structural" && calibrations[s.id]?.pixelsPerFoot);
  if (structurals.length === 0) return { calibration: null, sourceSheetId: null };
  const prefix = (target.sheetNumber || "").replace(/\d+/g, "").slice(0, 3).toUpperCase();
  const prefixMatch = prefix
    ? structurals.find((s) => (s.sheetNumber || "").toUpperCase().startsWith(prefix))
    : null;
  const pick = prefixMatch || structurals[0];
  return { calibration: calibrations[pick.id], sourceSheetId: pick.id };
}
