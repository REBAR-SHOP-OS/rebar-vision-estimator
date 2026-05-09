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
  | "known_object"
  | "user";

export type CalibrationConfidence = "high" | "medium" | "low" | "user";

export interface Calibration {
  source: CalibrationSource;
  scaleText?: string;
  pixelsPerFoot: number;
  confidence: CalibrationConfidence;
  method: string;
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

/** Try every layer in priority order. */
export function resolveScale(input: SheetScaleInputs): Calibration | null {
  const a = tryTitleBlockText(input.rawText);
  if (a && a.pixelsPerFoot > 0 && a.confidence === "high") return a;
  const b = tryDimensionAnnotation(input.dimensions);
  if (b && b.pixelsPerFoot > 0) return b;
  const c = tryKnownObject(input.knownObjects);
  if (c) return c;
  return a; // may be a low-confidence "SCALE keyword found" hit
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
