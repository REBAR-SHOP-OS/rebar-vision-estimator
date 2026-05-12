import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXTRACTION_VERSION = "2026.05.07";

const COMMON_WORDS = new Set([
  "OF","IN","AT","TO","AS","IS","IT","OR","ON","IF","NO","DO","UP","BY","AN","BE","SO","WE","HE","ME",
  "MY","US","AM","GO","HA","OK","OH","AH","RE","MM","CM","DIA","THE","AND","FOR","ARE","BUT","NOT",
]);

/** Expanded bar mark patterns */
function extractBarMarks(text: string): string[] {
  const patterns = [
    /\b([A-Z]{1,2}\d{1,3})\b/g,
    /\bBM[- ]?(\d{1,5})\b/gi,
    /\b(\d{1,5}[A-Z])\b/g,
    /\b(#\d{1,3})\b/g,
  ];
  const marks = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const bm = (match[1] || match[0]).toUpperCase().replace(/^BM[- ]?/, "BM");
      if (!COMMON_WORDS.has(bm) && bm.length <= 8) {
        marks.add(bm);
      }
    }
  }
  return Array.from(marks);
}

/** Pre-clean OCR text: normalize dashes and collapse split-character bar tokens. */
function preCleanOcr(text: string): string {
  let t = text.replace(/[–—]/g, "-");
  // Collapse "1 5 M" / "1 5M" -> "15M"
  t = t.replace(/\b(\d)\s+(\d)\s*M\b/g, "$1$2M");
  // Collapse "# 5" -> "#5"
  t = t.replace(/#\s+(\d)/g, "#$1");
  // Collapse "15M @ 300" extra space
  t = t.replace(/(\d)\s+M\b/g, "$1M");
  return t;
}

/** Detect placement modifier near a bar callout match. Returns canonical token or null. */
function detectPlacement(tail: string): string | null {
  const u = tail.toUpperCase();
  if (/\bT\s*&\s*B\b|\bBW\b|\bBOTH\s+WAYS?\b|\bTOP\s*(?:AND|&)\s*BOT/.test(u)) return "T&B";
  if (/\bEW\b|\bEACH\s+WAY\b/.test(u)) return "EW";
  if (/\bEF\b|\bEACH\s+FACE\b/.test(u)) return "EF";
  if (/\bCONT\b|\bCONTINUOUS\b/.test(u)) return "CONT";
  if (/\bTIES?\b/.test(u)) return "TIES";
  if (/\bSTIRR(?:UPS?)?\b/.test(u)) return "STIRR";
  if (/\bDWLS?\b|\bDOWELS?\b/.test(u)) return "DWL";
  if (/\bTOP\b/.test(u)) return "TOP";
  if (/\bBOT(?:TOM)?\b/.test(u)) return "BOT";
  return null;
}

/** Structured bar callouts: "5-15M @ 300 EW", "4-#5 @ 12\" T&B", "15M CONT", "10M TIES @ 200", "(2)-25M". */
function extractBarCallouts(rawText: string): Array<Record<string, unknown>> {
  const text = preCleanOcr(rawText);
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const push = (o: Record<string, unknown>) => {
    const k = JSON.stringify(o);
    if (!seen.has(k)) { seen.add(k); out.push(o); }
  };
  const tailOf = (idx: number, len: number) => text.slice(idx + len, idx + len + 40);
  let m: RegExpExecArray | null;

  // Metric: qty - sizeM @ spacing  (+ optional placement modifier)
  const reMetric = /(\d{1,3})\s*-\s*(\d{2})M\s*@\s*(\d{2,4})\s*(?:mm|MM|o\.?c\.?|c\/c)?/g;
  while ((m = reMetric.exec(text)) !== null) {
    const placement = detectPlacement(tailOf(m.index, m[0].length));
    push({ qty: +m[1], size: `${m[2]}M`, spacing: +m[3], spacing_unit: "mm", placement, raw: m[0] });
  }
  // Metric no qty: sizeM @ spacing
  const reMetricNoQty = /\b(\d{2})M\s*@\s*(\d{2,4})\s*(?:mm|MM|o\.?c\.?|c\/c)?/g;
  while ((m = reMetricNoQty.exec(text)) !== null) {
    const placement = detectPlacement(tailOf(m.index, m[0].length));
    push({ size: `${m[1]}M`, spacing: +m[2], spacing_unit: "mm", placement, raw: m[0] });
  }
  // Imperial: qty - #N @ spacing
  const reImp = /(\d{1,3})\s*-\s*#(\d{1,2})\s*@\s*(\d+(?:\.\d+)?)\s*(?:"|in|''|o\.?c\.?|c\/c)?/gi;
  while ((m = reImp.exec(text)) !== null) {
    const placement = detectPlacement(tailOf(m.index, m[0].length));
    push({ qty: +m[1], size: `#${m[2]}`, spacing: +m[3], spacing_unit: "in", placement, raw: m[0] });
  }
  // Continuous: "4-25M CONT" / "15M CONT"
  const reCont = /(?:(\d{1,3})\s*-\s*)?(\d{2})M\s+(?:CONT|CONTINUOUS)\b/gi;
  while ((m = reCont.exec(text)) !== null) {
    push({ qty: m[1] ? +m[1] : null, size: `${m[2]}M`, placement: "CONT", raw: m[0] });
  }
  // Ties / Stirrups: "10M TIES @ 200"
  const reTies = /(\d{2})M\s+(TIES?|STIRR(?:UPS?)?|DWLS?|DOWELS?)\s*@\s*(\d{2,4})/gi;
  while ((m = reTies.exec(text)) !== null) {
    const u = m[2].toUpperCase();
    const placement = u.startsWith("TIE") ? "TIES" : u.startsWith("STIRR") ? "STIRR" : "DWL";
    push({ size: `${m[1]}M`, spacing: +m[3], spacing_unit: "mm", placement, raw: m[0] });
  }
  // Ties / Stirrups without explicit spacing: "10M TIES"
  const reTiesBare = /\b(\d{2})M\s+(TIES?|STIRR(?:UPS?)?|DWLS?|DOWELS?)\b(?!\s*@)/gi;
  while ((m = reTiesBare.exec(text)) !== null) {
    const u = m[2].toUpperCase();
    const placement = u.startsWith("TIE") ? "TIES" : u.startsWith("STIRR") ? "STIRR" : "DWL";
    push({ size: `${m[1]}M`, placement, raw: m[0] });
  }
  // Qty-size with placement (no spacing): "2-15M TOP", "6-20M BOT", "4-25M EW"
  const reQtyPlace = /(\d{1,3})\s*-\s*(\d{2})M\s+(TOP|BOT(?:TOM)?|EW|EF|T\s*&\s*B|CONT(?:INUOUS)?)\b/gi;
  while ((m = reQtyPlace.exec(text)) !== null) {
    const placement = detectPlacement(m[3]) || m[3].toUpperCase();
    push({ qty: +m[1], size: `${m[2]}M`, placement, raw: m[0] });
  }
  // Bundled / parenthesized qty: "(2)-25M" or "2-25M BUNDLE"
  const reBundle = /\(?\s*(\d)\s*\)?\s*-\s*(\d{2})M(?:\s+BUNDLE)?/g;
  while ((m = reBundle.exec(text)) !== null) {
    const tail = tailOf(m.index, m[0].length).toUpperCase();
    const explicit = /BUNDLE/.test(m[0].toUpperCase()) || /\bBUNDLE\b/.test(tail);
    if (!explicit && +m[1] > 1) continue;
    push({ qty: +m[1], size: `${m[2]}M`, bundled: true, raw: m[0] });
  }
  return out;
}

/** Specs / general-notes extractor: cover, lap, hook, grade, splice. */
function extractSpecs(rawText: string): Record<string, unknown> {
  const text = preCleanOcr(rawText).toUpperCase();
  const specs: Record<string, any> = {
    cover: {}, lap: {}, hook: {}, grade: {},
    concrete_strength: {} as Record<string, number>,
    exposure_class: [] as string[],
    codes: [] as string[],
    bearing: {} as Record<string, number>,
    detected_keywords: [] as string[],
  };
  let m: RegExpExecArray | null;

  // Cover: "50MM BOTTOM" / "75MM AGAINST EARTH" / "40MM CLEAR"
  const reCover = /(\d{2,3})\s*MM\s+(BOTTOM|TOP|SIDE|EARTH|SOFFIT|EXPOSED|CLEAR)/g;
  while ((m = reCover.exec(text)) !== null) {
    const where = m[2];
    const v = +m[1];
    if (where === "BOTTOM" || where === "SOFFIT") specs.cover.bottom_mm = v;
    else if (where === "TOP") specs.cover.top_mm = v;
    else if (where === "SIDE" || where === "EXPOSED") specs.cover.side_mm = v;
    else if (where === "EARTH") specs.cover.against_earth_mm = v;
    else if (where === "CLEAR") specs.cover.clear_mm = v;
    specs.detected_keywords.push(`cover:${where}=${v}`);
  }
  // "CLEAR COVER 40MM" / "MIN. COVER = 50 MM" / "MINIMUM CONCRETE COVER 75 MM"
  const reCover2 = /(?:CLEAR|MIN(?:IMUM)?\.?|MINIMUM\s+CONCRETE)\s+COVER[\s:=]+(\d{2,3})\s*MM/g;
  while ((m = reCover2.exec(text)) !== null) {
    specs.cover.clear_mm = +m[1];
    specs.detected_keywords.push(`cover:clear=${m[1]}`);
  }

  // Lap: "TENSION LAP = 40DB" / "COMPRESSION LAP 30 DB"
  const reLap = /(TENSION|COMPRESSION)\s+LAP\s*=?\s*(\d{2,3})\s*DB/g;
  while ((m = reLap.exec(text)) !== null) {
    if (m[1] === "TENSION") specs.lap.tension_db = +m[2];
    else specs.lap.compression_db = +m[2];
    specs.detected_keywords.push(`lap:${m[1]}=${m[2]}db`);
  }
  // Plain "LAP 40 DB" or "40 BAR DIAMETERS"
  const reLapBare = /\bLAP\s*[:=]?\s*(\d{2,3})\s*(?:DB|BAR\s*DIA(?:METER)?S?)/g;
  while ((m = reLapBare.exec(text)) !== null) {
    specs.lap.tension_db = specs.lap.tension_db ?? +m[1];
    specs.detected_keywords.push(`lap:db=${m[1]}`);
  }
  // "CLASS A SPLICE" / "CLASS B LAP SPLICE"
  const reClass = /\bCLASS\s+([AB])\s+(?:LAP\s+)?SPLICE/g;
  while ((m = reClass.exec(text)) !== null) {
    specs.lap.splice_class = m[1];
    specs.detected_keywords.push(`lap:class=${m[1]}`);
  }
  if (/MECHANICAL\s+COUPLER/.test(text)) specs.lap.splice_type = "mechanical";
  else if (/WELDED\s+SPLICE/.test(text)) specs.lap.splice_type = "welded";
  else if (/LAP\s+SPLICE/.test(text)) specs.lap.splice_type = "lap";

  // Hooks
  const reHook = /(STD|STANDARD|SEISMIC)\s+HOOK\s*=?\s*(90|135|180)/g;
  while ((m = reHook.exec(text)) !== null) {
    if (m[1] === "SEISMIC") specs.hook.seismic_deg = +m[2];
    else specs.hook.standard_deg = +m[2];
    specs.detected_keywords.push(`hook:${m[1]}=${m[2]}`);
  }

  // Grade
  const reFy = /\b(?:FY|YIELD\s+STRENGTH)\s*[:=]?\s*(\d{2,3})\s*(MPA|KSI)?/g;
  while ((m = reFy.exec(text)) !== null) {
    const v = +m[1];
    if (m[2] === "KSI" || (!m[2] && v <= 80)) specs.grade.fy_ksi = v;
    else specs.grade.fy_mpa = v;
    specs.detected_keywords.push(`grade:fy=${v}${m[2] || "MPA"}`);
  }
  const reMark = /\b(400W|400R|500W|GRADE\s*60|GRADE\s*75|G30\.18[A-Z0-9.\-]*)\b/g;
  while ((m = reMark.exec(text)) !== null) {
    const mk = m[1].replace(/\s+/g, " ");
    specs.grade.mark = mk;
    specs.detected_keywords.push(`grade:${mk}`);
  }

  // Concrete strength per element-bucket: "FOOTINGS ... 25 MPA"
  const buckets = [
    ["FOOTINGS?", "footings"],
    ["FND\\.?\\s*WALLS?|FOUNDATION\\s+WALLS?", "fnd_walls"],
    ["WALLS?", "walls"],
    ["BEAMS?", "beams"],
    ["COLUMNS?(?:\\s*\\/\\s*PIERS?)?", "columns_piers"],
    ["S\\.?O\\.?G\\.?|SLAB\\s+ON\\s+GRADE", "sog"],
    ["SUSP(?:ENDED)?\\.?\\s*SLABS?", "suspended_slab"],
    ["CURBS?(?:\\s*\\/\\s*WALKS?)?", "curbs_walks"],
    ["TOPPING\\s+SLABS?", "topping_slab"],
    ["PILE\\s*CAPS?", "pile_caps"],
  ] as const;
  for (const [pat, key] of buckets) {
    const re = new RegExp(`\\b(?:${pat})\\b[^\\n]{0,140}?(?<!\\d)(\\d{2})\\s*MPA`, "g");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text)) !== null) {
      const v = +mm[1];
      if (v < 15 || v > 80) continue;
      if (specs.concrete_strength[key] == null) {
        specs.concrete_strength[key] = v;
        specs.detected_keywords.push(`fc:${key}=${v}MPa`);
      }
    }
  }
  // Plain Fc' = 25 MPa
  const reFc = /\b(?:FC['\u2032]?|F'?C)\s*[:=]?\s*(?<!\d)(\d{2})\s*MPA/g;
  while ((m = reFc.exec(text)) !== null) {
    const v = +m[1];
    if (v >= 15 && v <= 80 && specs.concrete_strength.default == null) {
      specs.concrete_strength.default = v;
      specs.detected_keywords.push(`fc:default=${v}MPa`);
    }
  }

  // Exposure / durability classes (CSA A23.1)
  const reExp = /\b(C-?XL|C-?[12]|F-?[12]|S-?[123]|A-?[123]|R-?[12])\b/g;
  const seenExp = new Set<string>();
  while ((m = reExp.exec(text)) !== null) {
    const c = m[1].replace(/-/g, "");
    if (!seenExp.has(c)) { seenExp.add(c); specs.exposure_class.push(c); }
  }
  if (specs.exposure_class.length) specs.detected_keywords.push(`exposure:${specs.exposure_class.join(",")}`);

  // Code refs
  const reCodes = /\b(CAN\/CSA\s*A23\.[123]|CSA\s*A23\.[123]|CSA\s*G30\.18|ACI\s*30[18]|ACI\s*318|OBC|NBCC?)\b/g;
  const seenC = new Set<string>();
  while ((m = reCodes.exec(text)) !== null) {
    const c = m[1].replace(/\s+/g, " ");
    if (!seenC.has(c)) { seenC.add(c); specs.codes.push(c); }
  }
  if (specs.codes.length) specs.detected_keywords.push(`codes:${specs.codes.length}`);

  // Geotech bearing: SLS/ULS may appear before or after the kPa value
  const reBear1 = /(\d{2,4})\s*KPA[^\n]{0,30}?\b(SLS|ULS)\b/g;
  const reBear2 = /\b(SLS|ULS)\b[^\n]{0,80}?(\d{2,4})\s*KPA/g;
  for (const re of [reBear1, reBear2]) {
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text)) !== null) {
      const isFirstNum = re === reBear1;
      const tag = isFirstNum ? mm[2] : mm[1];
      const v = +(isFirstNum ? mm[1] : mm[2]);
      const k = tag === "SLS" ? "sls_kpa" : "uls_kpa";
      if (specs.bearing[k] == null) {
        specs.bearing[k] = v;
        specs.detected_keywords.push(`bearing:${tag}=${v}kPa`);
      }
    }
  }

  return specs;
}

/** Element dimensions in mm. Filters bar sizes (<100mm) and noise (>200,000mm). */
function extractDimensions(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  // Classify a dimension by its surrounding text context.
  const classify = (ctx: string): string => {
    const u = ctx.toUpperCase();
    if (/\bCLR\b|\bCLEAR\b|\bCOVER\b/.test(u)) return "cover";
    if (/\bTHK\b|\bTHICK(?:NESS)?\b|\bSLAB\b|\bWALL\b|\bDECK\b/.test(u)) return "thickness";
    if (/\bDIA\b|\bDIAM(?:ETER)?\b|[ØΦø]/.test(u)) return "diameter";
    if (/\bSPA(?:CING|CED)?\b|\bO\.?C\.?\b|\b@\s*$|\bEACH\s+WAY\b|\bE\.?W\.?\b/.test(u)) return "spacing";
    if (/\bCLEARANCE\b|\bGAP\b/.test(u)) return "clearance";
    if (/\bEL(?:EV)?\.?\b|\bELEVATION\b|\bT\.?O\.?\b|\bB\.?O\.?\b/.test(u)) return "elevation";
    if (/\bHT\b|\bHEIGHT\b|\bDEPTH\b|\bDP\b/.test(u)) return "height";
    if (/\bWIDTH\b|\bWD\b/.test(u)) return "width";
    if (/\bLAP\b|\bSPLICE\b/.test(u)) return "lap";
    if (/\bLENGTH\b|\bLG\b|\bLONG\b/.test(u)) return "length";
    return "unknown";
  };
  const push = (v: number, raw: string, kind: string) => {
    if (v < 100 || v > 200_000) return;
    const k = `${v}|${raw}|${kind}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ value_mm: Math.round(v), raw, kind });
  };
  const ctxOf = (idx: number, len: number): string =>
    text.slice(Math.max(0, idx - 24), Math.min(text.length, idx + len + 24));
  let m: RegExpExecArray | null;
  const reMm = /\b(\d{3,5})\s*(?:mm|MM)\b/g;
  while ((m = reMm.exec(text)) !== null) push(+m[1], m[0], classify(ctxOf(m.index, m[0].length)));
  const reM = /\b(\d{1,3}(?:\.\d{1,3})?)\s*m\b(?!m)/g;
  while ((m = reM.exec(text)) !== null) push(parseFloat(m[1]) * 1000, m[0], classify(ctxOf(m.index, m[0].length)));
  const reFt = /\b(\d{1,3})['′]\s*[-–]?\s*(\d{1,2})?\s*["″]?/g;
  while ((m = reFt.exec(text)) !== null) {
    const ft = +m[1];
    const inch = m[2] ? +m[2] : 0;
    push((ft * 12 + inch) * 25.4, m[0], classify(ctxOf(m.index, m[0].length)));
  }
  return out.slice(0, 500);
}

/**
 * Bar schedule rows. Header-driven: detects column order from the header line
 * (MARK, SIZE, NO/QTY, LENGTH/CUT, SHAPE, A, B, C, D, E, R) and emits structured
 * rows. Computes cut length from A+B+C+D+E when LENGTH column is missing.
 */
function extractBarSchedule(text: string): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/);
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  // Tokens we care about (uppercase). Single letters A/B/C/D/E/R are bend legs (BS 8666).
  const COL_TOKENS: Record<string, string> = {
    MARK: "mark", "BAR MARK": "mark",
    SIZE: "size", BAR: "size",
    NO: "qty", "NO.": "qty", QTY: "qty", QUANTITY: "qty", "NO OF BARS": "qty", COUNT: "qty",
    LENGTH: "length", "CUT LENGTH": "length", LEN: "length", TOTAL: "length",
    SHAPE: "shape", "SHAPE CODE": "shape", CODE: "shape", TYPE: "shape",
    SPACING: "spacing", SPA: "spacing", "@": "spacing",
    WEIGHT: "weight", WT: "weight", MASS: "weight",
    A: "a", B: "b", C: "c", D: "d", E: "e", R: "r",
  };

  // Tokenize a header into ordered column names by splitting on 2+ spaces / tab.
  const parseHeader = (line: string): string[] | null => {
    const u = line.toUpperCase().trim();
    const cells = u.split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
    if (cells.length < 3) return null;
    const cols: string[] = [];
    let hits = 0;
    for (const cell of cells) {
      const key = COL_TOKENS[cell] ?? null;
      cols.push(key ?? "_");
      if (key) hits++;
    }
    // Need MARK or SIZE plus at least 2 schedule fields total.
    if (hits < 3) return null;
    if (!cols.includes("mark") && !cols.includes("size")) return null;
    return cols;
  };

  // Tokenize a row similarly. Numbers stay strings; we coerce later.
  const parseRow = (line: string): string[] => {
    return line.trim().split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
  };

  const isMark = (s: string) => /^[A-Z]{1,3}\d{1,4}[A-Z]?$/i.test(s);
  const isSize = (s: string) => /^(?:\d{1,2}M|#\d{1,2})$/i.test(s);
  const isInt = (s: string) => /^\d{1,4}$/.test(s);
  const isLen = (s: string) => /^\d{2,5}(?:\.\d{1,2})?$/.test(s);
  const isShape = (s: string) => /^[A-Z]?\d{2}$/.test(s) || /^SC\d{2,3}$/.test(s); // BS8666 (00-99) or "SC###"

  for (let i = 0; i < lines.length; i++) {
    const cols = parseHeader(lines[i]);
    if (!cols) continue;
    const end = Math.min(i + 200, lines.length);
    for (let j = i + 1; j < end; j++) {
      const cells = parseRow(lines[j]);
      if (cells.length < 2) continue;
      // Map cells to column names by index; ignore extras.
      const row: Record<string, string | number> = {};
      for (let k = 0; k < Math.min(cells.length, cols.length); k++) {
        const name = cols[k]; const val = cells[k];
        if (name === "_") continue;
        row[name] = val;
      }
      // Validate plausibility.
      const mark = String(row.mark ?? "");
      const size = String(row.size ?? "");
      if (!isMark(mark) && !isSize(size)) continue;
      if (size && !isSize(size)) continue;
      // Coerce numerics.
      const numKeys = ["qty", "length", "spacing", "weight", "a", "b", "c", "d", "e", "r"];
      for (const k of numKeys) {
        const v = row[k]; if (typeof v === "string" && /^\d/.test(v)) {
          const n = Number(v);
          if (!Number.isNaN(n)) row[k] = n;
        }
      }
      // Compute cut length if missing and bend legs present.
      if (row.length == null) {
        const parts = ["a", "b", "c", "d", "e"]
          .map((k) => (typeof row[k] === "number" ? (row[k] as number) : 0));
        const sum = parts.reduce((s, n) => s + n, 0);
        if (sum > 0) {
          row.length = sum;
          row.length_computed = true;
        }
      }
      // Normalize shape code if present
      if (typeof row.shape === "string") row.shape = row.shape.toUpperCase();
      // De-dupe
      const k = `${mark}|${size}|${row.length ?? ""}|${row.qty ?? ""}|${row.shape ?? ""}`;
      if (seen.has(k)) continue; seen.add(k);
      // Drop empty rows
      const fieldCount = Object.keys(row).length;
      if (fieldCount < 2) continue;
      out.push(row);
      if (out.length > 200) break;
    }
    if (out.length > 0) break;
  }
  return out;
}

function computeQualityFlags(page: {
  raw_text?: string;
  title_block?: Record<string, string>;
  bar_marks: string[];
  sheet_id: string | null;
  is_ocr?: boolean;
  ocr_metadata?: {
    render_scale?: number | null;
    crop_passes?: Array<{ kind?: string; text_length?: number | null }>;
  } | null;
}): string[] {
  const flags: string[] = [];
  if (page.is_ocr) flags.push("ocr_used");
  if (!page.sheet_id) flags.push("missing_sheet_id");
  if (!page.title_block?.scale) flags.push("missing_scale");
  if (page.bar_marks.length === 0) flags.push("no_bar_marks");
  if (!page.raw_text || page.raw_text.length < 50) flags.push("sparse_text");
  if (page.is_ocr && Number(page.ocr_metadata?.render_scale || 0) > 0 && Number(page.ocr_metadata?.render_scale || 0) < 2.25) {
    flags.push("low_dpi_ocr");
  }
  if (page.is_ocr && page.ocr_metadata && (!Array.isArray(page.ocr_metadata.crop_passes) || page.ocr_metadata.crop_passes.length === 0)) {
    flags.push("targeted_ocr_missing");
  }
  return flags;
}

function computeConfidence(flags: string[]): number {
  let score = 1.0;
  const penalties: Record<string, number> = {
    missing_sheet_id: 0.2,
    missing_scale: 0.1,
    no_bar_marks: 0.1,
    sparse_text: 0.2,
    ocr_used: 0.05,
    low_dpi_ocr: 0.2,
    targeted_ocr_missing: 0.1,
  };
  for (const f of flags) {
    score -= penalties[f] || 0;
  }
  return Math.max(0, Math.round(score * 100) / 100);
}

function parseScaleRatio(scaleRaw: string | null | undefined): number | null {
  const raw = String(scaleRaw || "").trim();
  const ratio = raw.match(/1\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (ratio) return Number(ratio[1]);
  const metric = raw.match(/(\d+(?:\.\d+)?)\s*mm\s*=\s*(\d+(?:\.\d+)?)\s*m/i);
  if (metric) return (Number(metric[2]) * 1000) / Number(metric[1]);
  return null;
}

function mapSheetCategory(drawingType: string | null, rawText: string): string {
  const haystack = `${drawingType || ""} ${rawText.slice(0, 400)}`.toLowerCase();
  if (haystack.includes("foundation")) return "foundation_plan";
  if (haystack.includes("slab")) return "slab_plan";
  if (haystack.includes("wall section") || haystack.includes("wall sec")) return "wall_section";
  if (haystack.includes("grade beam")) return "grade_beam_detail";
  if (haystack.includes("schedule")) return "schedule";
  if (haystack.includes("notes") || haystack.includes("general note")) return "notes";
  if (haystack.trim().length > 0) return "general";
  return "unknown";
}

/**
 * Classify a sheet by discipline / drawing-type / sheet-id prefix and decide
 * whether it is rebar-relevant. Used to gate downstream auto-estimate logic so
 * arch / MEP / landscape sheets do not contribute false-positive bar callouts.
 */
function classifySheet(
  sheetId: string | null,
  discipline: string | null,
  drawingType: string | null,
  rawText: string,
): { category: string; rebar_relevant: boolean; reason: string } {
  const disc = (discipline || "").toUpperCase().trim();
  const dt = (drawingType || "").toLowerCase();
  const sid = (sheetId || "").toUpperCase().trim();
  const head = rawText.slice(0, 600).toLowerCase();

  // Sheet-id prefix is the strongest signal (e.g. S-201, A-101, M-301).
  const prefix = sid.match(/^([A-Z]{1,3})[\s\-_]?\d/)?.[1] || "";
  const PREFIX_MAP: Record<string, string> = {
    S: "structural", SD: "structural", SK: "structural",
    A: "architectural", AD: "architectural", ID: "architectural",
    M: "mep", H: "mep", P: "mep", FP: "mep", FA: "mep",
    E: "electrical", EL: "electrical",
    C: "civil", CG: "civil", L: "landscape", LS: "landscape",
    T: "telecom",
  };
  let category = PREFIX_MAP[prefix] || "";

  // Discipline override.
  if (!category) {
    if (/STRUCT/i.test(disc)) category = "structural";
    else if (/ARCH/i.test(disc)) category = "architectural";
    else if (/MECH|HVAC|PLUMB/i.test(disc)) category = "mep";
    else if (/ELEC/i.test(disc)) category = "electrical";
    else if (/CIVIL|SITE/i.test(disc)) category = "civil";
    else if (/LAND/i.test(disc)) category = "landscape";
  }

  // Last-resort content sniff for unknown headers.
  if (!category) {
    if (/\b(rebar|reinforce|stirrup|tie|footing|grade beam|pile cap)\b/.test(head) ||
        /\b\d{1,3}\s*M\b/.test(rawText.slice(0, 1000))) category = "structural";
    else if (/\b(door schedule|window schedule|partition|finish)\b/.test(head)) category = "architectural";
    else if (/\b(duct|hvac|plumbing|sprinkler|fire alarm)\b/.test(head)) category = "mep";
    else category = "other";
  }

  const rebar_relevant = category === "structural";
  const reason = `prefix=${prefix || "?"} discipline=${disc || "?"} type=${dt || "?"}`;
  return { category, rebar_relevant, reason };
}

async function syncRebarDrawingPage(params: {
  supabase: any;
  rebarProjectFileId: string | null;
  pageNumber: number;
  rawText: string;
  titleBlock: Record<string, string>;
  discipline: string | null;
  drawingType: string | null;
  barMarks: string[];
  confidence: number;
  isOcr: boolean;
  ocrMetadata?: Record<string, unknown> | null;
}) {
  const {
    supabase,
    rebarProjectFileId,
    pageNumber,
    rawText,
    titleBlock,
    discipline,
    drawingType,
    barMarks,
    confidence,
    isOcr,
    ocrMetadata,
  } = params;

  if (!rebarProjectFileId) return;

  const sheetNumber = titleBlock.sheet_number || null;
  const sheetName = titleBlock.sheet_title || titleBlock.sheet_name || drawingType || null;
  const revisionLabel = titleBlock.revision_code || null;
  const scaleText = titleBlock.scale || null;
  const detectedCategory = mapSheetCategory(drawingType, rawText);

  const { data: drawingSheets, error: sheetError } = await supabase
    .schema("rebar")
    .from("drawing_sheets")
    .upsert(
      {
        project_file_id: rebarProjectFileId,
        page_number: pageNumber,
        sheet_number: sheetNumber,
        sheet_name: sheetName,
        detected_category: detectedCategory,
        discipline,
        revision_label: revisionLabel,
        scale_text: scaleText,
        scale_confidence: scaleText ? confidence : null,
        notes_found: /\bnote(s)?\b/i.test(rawText),
        ocr_text: rawText,
      },
      { onConflict: "project_file_id,page_number" },
    )
    .select("id")
    .limit(1);

  const drawingSheetId = drawingSheets?.[0]?.id;
  if (sheetError || !drawingSheetId) {
    console.error("Failed to sync rebar drawing sheet:", sheetError);
    return;
  }

  await supabase.schema("rebar").from("drawing_detections").delete().eq("drawing_sheet_id", drawingSheetId);

  const detections: Array<Record<string, unknown>> = [];
  const pushDetection = (detectionType: string, label: string, valueText: string | null, metadata: Record<string, unknown> = {}) => {
    if (!valueText) return;
    detections.push({
      drawing_sheet_id: drawingSheetId,
      detection_type: detectionType,
      label,
      value_text: valueText,
      confidence,
      metadata,
    });
  };

  pushDetection("title_block", "sheet_number", sheetNumber, { source: "title_block" });
  pushDetection("title_block", "sheet_name", sheetName, { source: "title_block" });
  pushDetection("title_block", "discipline", discipline, { source: "title_block" });
  pushDetection("title_block", "revision", revisionLabel, { source: "title_block" });
  pushDetection("title_block", "scale", scaleText, { source: "title_block" });
  pushDetection("drawing_type", "drawing_type", drawingType, { source: "title_block" });
  if (barMarks.length > 0) {
    detections.push({
      drawing_sheet_id: drawingSheetId,
      detection_type: "bar_marks",
      label: "bar_marks",
      value_text: barMarks.join(", "),
      confidence,
      metadata: { count: barMarks.length },
    });
  }
  detections.push({
    drawing_sheet_id: drawingSheetId,
    detection_type: "ocr",
    label: isOcr ? "ocr_page" : "text_page",
    value_text: rawText.slice(0, 1000),
    confidence,
    metadata: { extraction_version: EXTRACTION_VERSION, ocr_metadata: ocrMetadata || null },
  });

  if (detections.length > 0) {
    const { error: detectionError } = await supabase.schema("rebar").from("drawing_detections").insert(detections);
    if (detectionError) {
      console.error("Failed to sync rebar drawing detections:", detectionError);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("authorization");
    let userId: string | null = null;
    if (authHeader) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await anonClient.auth.getUser(token);
      userId = user?.id || null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      project_id,
      pages,
      document_version_id,
      crm_deal_id,
      drawing_set_id,
      sha256: doc_sha256,
      pipeline_file_id,
      source_system,
      is_ocr,
      legacy_file_id,
    } = body;

    if (!project_id || !pages || !Array.isArray(pages)) {
      return new Response(JSON.stringify({ error: "project_id and pages[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.info("[populate-search-index] request received", {
      project_id,
      document_version_id: document_version_id || null,
      pipeline_file_id: pipeline_file_id || legacy_file_id || null,
      page_count: pages.length,
      source_system: source_system || "upload",
      is_ocr: Boolean(is_ocr),
    });

    const bridgeLookupFileId = legacy_file_id || pipeline_file_id || null;

    let rebarProjectFileId: string | null = null;
    if (bridgeLookupFileId) {
      const { data: linkRow } = await supabase
        .from("rebar_project_file_links")
        .select("rebar_project_file_id")
        .eq("legacy_file_id", bridgeLookupFileId)
        .maybeSingle();
      rebarProjectFileId = linkRow?.rebar_project_file_id || null;
    }

    if (doc_sha256) {
      const { data: existing } = await supabase
        .from("drawing_search_index")
        .select("id, project_id")
        .eq("sha256", doc_sha256)
        .eq("user_id", userId)
        .eq("project_id", project_id)
        .limit(1)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({
            indexed: 0,
            skipped: pages.length,
            total: pages.length,
            conflicts: [],
            duplicate_of: existing.id,
            message: `Exact duplicate detected (SHA-256 match). Existing entry: ${existing.id}`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let indexed = 0;
    let skipped = 0;
    const conflicts: string[] = [];
    const qualityIssues: string[] = [];
    const errors: string[] = [];
    const disciplineCounts: Record<string, number> = {};
    // Cross-page reconciliation accumulator: tracks every bar mark sighting and
    // its sheet category so we can flag (a) marks only seen on non-rebar sheets
    // and (b) marks with conflicting sizes across rebar sheets.
    type MarkSighting = {
      page_number: number;
      sheet_id: string | null;
      category: string;
      rebar_relevant: boolean;
      size: string | null;
    };
    const markSightings = new Map<string, MarkSighting[]>();

    for (const page of pages) {
      const tb = page.title_block || {};
      const rawText = page.raw_text || "";

      if (!rawText.trim()) {
        skipped++;
        continue;
      }

      const barMarks = extractBarMarks(rawText);
      const sheetId = tb.sheet_number || null;
      const discipline = tb.discipline || null;
      const disciplineKey = (discipline || "unclassified").toLowerCase();
      disciplineCounts[disciplineKey] = (disciplineCounts[disciplineKey] || 0) + 1;
      const drawingType = tb.drawing_type || null;
      const sheetClass = classifySheet(sheetId, discipline, drawingType, rawText);
      // Record sightings of every bar mark seen on this page for the
      // post-loop cross-page reconciliation pass.
      const callouts = extractBarCallouts(rawText) as Array<Record<string, unknown>>;
      const calloutSizeByMark = new Map<string, string>();
      for (const c of callouts) {
        const mk = (c.mark as string) || (c.bar_mark as string) || null;
        const sz = (c.size as string) || (c.bar_size as string) || null;
        if (mk && sz && !calloutSizeByMark.has(mk)) calloutSizeByMark.set(mk, sz);
      }
      for (const mk of barMarks) {
        const list = markSightings.get(mk) || [];
        list.push({
          page_number: page.page_number || 0,
          sheet_id: sheetId,
          category: sheetClass.category,
          rebar_relevant: sheetClass.rebar_relevant,
          size: calloutSizeByMark.get(mk) || null,
        });
        markSightings.set(mk, list);
      }

      let logicalDrawingId: string | null = null;
      if (sheetId) {
        const { data: existing } = await supabase
          .from("logical_drawings")
          .select("id, revision_chain_id")
          .eq("user_id", userId)
          .eq("project_id", project_id)
          .eq("sheet_id", sheetId)
          .eq("drawing_type", drawingType || "")
          .maybeSingle();

        if (existing) {
          logicalDrawingId = existing.id;

          const newRevCode = tb.revision_code || null;
          if (newRevCode) {
            await supabase
              .from("logical_drawings")
              .update({ latest_revision_code: newRevCode })
              .eq("id", existing.id);
          }

          if (!existing.revision_chain_id) {
            const chainId = crypto.randomUUID();
            await supabase
              .from("logical_drawings")
              .update({ revision_chain_id: chainId })
              .eq("id", existing.id);
          }
        } else {
          const chainId = crypto.randomUUID();
          const { data: created } = await supabase
            .from("logical_drawings")
            .insert({
              user_id: userId,
              project_id,
              sheet_id: sheetId,
              discipline,
              drawing_type: drawingType,
              revision_chain_id: chainId,
              latest_revision_code: tb.revision_code || null,
            })
            .select("id")
            .single();
          logicalDrawingId = created?.id || null;
        }

        const newRevisionLabel = tb.revision_code || null;
        if (logicalDrawingId && newRevisionLabel) {
          const { data: existingEntries } = await supabase
            .from("drawing_search_index")
            .select("id, revision_label")
            .eq("logical_drawing_id", logicalDrawingId)
            .eq("user_id", userId)
            .not("revision_label", "is", null)
            .neq("revision_label", newRevisionLabel)
            .limit(1);

          if (existingEntries && existingEntries.length > 0) {
            const conflictNote = `Sheet ${sheetId}: existing rev "${existingEntries[0].revision_label}" vs new rev "${newRevisionLabel}"`;
            conflicts.push(conflictNote);
            await supabase.from("reconciliation_records").insert({
              user_id: userId,
              project_id,
              issue_type: "REVISION_CHAIN_AMBIGUOUS",
              notes: conflictNote,
              candidates: {
                logical_drawing_id: logicalDrawingId,
                sheet_id: sheetId,
                existing_revision: existingEntries[0].revision_label,
                new_revision: newRevisionLabel,
              },
              automated_reasoning: {
                source: "populate-search-index",
                action: "indexed_with_conflict",
                extraction_version: EXTRACTION_VERSION,
              },
            });
          }
        }
      } else {
        qualityIssues.push(`Page ${page.page_number}: missing sheet_id`);
        await supabase.from("reconciliation_records").insert({
          user_id: userId,
          project_id,
          issue_type: "MISSING_SHEET_ID",
          notes: `Page ${page.page_number}: no sheet ID detected in title block`,
          candidates: { page_number: page.page_number, raw_text_snippet: rawText.slice(0, 200) },
          automated_reasoning: {
            source: "populate-search-index",
            action: "flagged_missing_sheet_id",
            extraction_version: EXTRACTION_VERSION,
          },
        });
      }

      const qualityFlags = computeQualityFlags({
        raw_text: rawText,
        title_block: tb,
        bar_marks: barMarks,
        sheet_id: sheetId,
        is_ocr: is_ocr || page.is_ocr,
        ocr_metadata: page.ocr_metadata || null,
      });
      const confidence = computeConfidence(qualityFlags);
      const needsReview = qualityFlags.length > 0 && confidence < 0.7;

      const { error } = await supabase.rpc("upsert_search_index", {
        p_user_id: userId,
        p_project_id: project_id,
        p_logical_drawing_id: logicalDrawingId,
        p_document_version_id: document_version_id || null,
        p_page_number: page.page_number || null,
        p_raw_text: rawText,
        p_extracted_entities: {
          bar_marks: barMarks,
          bar_callouts: extractBarCallouts(rawText),
          dimensions: extractDimensions(rawText),
          bar_schedule_rows: extractBarSchedule(rawText),
          specs: extractSpecs(rawText),
          tables: page.tables || [],
          title_block: tb,
          ocr_metadata: page.ocr_metadata || null,
          sheet_category: sheetClass.category,
          rebar_relevant: sheetClass.rebar_relevant,
          sheet_classification_reason: sheetClass.reason,
        },
        p_bar_marks: barMarks,
        p_crm_deal_id: crm_deal_id || null,
        p_revision_label: tb.revision_code || null,
        p_issue_status: null,
      });

      if (error) {
        console.error(`Index page ${page.page_number} error:`, error);
        errors.push(`Page ${page.page_number || "?"}: ${error.message || String(error)}`);
      } else {
        const { data: latest } = await supabase
          .from("drawing_search_index")
          .select("id")
          .eq("user_id", userId)
          .eq("project_id", project_id)
          .eq("page_number", page.page_number || 0)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latest) {
          const updateFields: Record<string, unknown> = {
            confidence,
            quality_flags: qualityFlags,
            needs_review: needsReview,
            extraction_version: EXTRACTION_VERSION,
            source_system: source_system || "upload",
          };
          if (drawing_set_id) updateFields.drawing_set_id = drawing_set_id;
          if (doc_sha256) updateFields.sha256 = doc_sha256;
          if (pipeline_file_id) updateFields.pipeline_file_id = pipeline_file_id;

          await supabase
            .from("drawing_search_index")
            .update(updateFields)
            .eq("id", latest.id);
        }

        if (document_version_id) {
          const { data: sheetRows, error: sheetErr } = await supabase
            .from("document_sheets")
            .upsert(
              {
                project_id,
                user_id: userId,
                document_version_id,
                page_number: page.page_number || 1,
                sheet_number: sheetId,
                sheet_title: (tb as Record<string, string>).sheet_title || null,
                discipline,
                title_block_json: tb as Record<string, unknown>,
                scale_raw: (tb as Record<string, string>).scale || (tb as Record<string, string>).scale_raw || null,
                scale_ratio: parseScaleRatio((tb as Record<string, string>).scale || (tb as Record<string, string>).scale_raw || null),
                scale_confidence: ((tb as Record<string, string>).scale || (tb as Record<string, string>).scale_raw) ? confidence : null,
              },
              { onConflict: "document_version_id,page_number" },
            )
            .select("id")
            .limit(1);
          const sheetIdRow = sheetRows?.[0];
          if (!sheetErr && sheetIdRow?.id) {
            await supabase.from("extracted_entities").insert({
              project_id,
              user_id: userId,
              document_version_id,
              document_sheet_id: sheetIdRow.id,
              page_number: page.page_number || null,
              entity_type: "page_bar_mark_index",
              payload: {
                bar_marks: barMarks,
                quality_flags: qualityFlags,
                page_number: page.page_number,
                ocr_metadata: page.ocr_metadata || null,
              },
              extraction_method: is_ocr || page.is_ocr ? "ocr" : "vector_pdf",
              confidence,
              validation_status: needsReview ? "pending" : "ok",
              review_required: needsReview,
            });
          }
        }

        await syncRebarDrawingPage({
          supabase,
          rebarProjectFileId,
          pageNumber: page.page_number || 1,
          rawText,
          titleBlock: tb,
          discipline,
          drawingType,
          barMarks,
          confidence,
          isOcr: Boolean(is_ocr || page.is_ocr),
          ocrMetadata: page.ocr_metadata || null,
        });

        indexed++;
      }
    }

    // ---- Cross-page reconciliation (#8) ----
    // 1) Bar marks that appear ONLY on non-rebar-relevant sheets are likely
    //    OCR false positives (e.g. door tags on arch sheets).
    // 2) Bar marks whose size disagrees across rebar-relevant sheets.
    for (const [mark, sightings] of markSightings.entries()) {
      const onRebar = sightings.filter((s) => s.rebar_relevant);
      if (onRebar.length === 0) {
        const note = `Bar mark "${mark}" only seen on non-rebar sheets (${sightings.map((s) => `${s.sheet_id || "?"}:${s.category}`).join(", ")})`;
        conflicts.push(note);
        await supabase.from("reconciliation_records").insert({
          user_id: userId,
          project_id,
          issue_type: "BAR_MARK_NOT_ON_STRUCTURAL",
          notes: note,
          candidates: { mark, sightings },
          automated_reasoning: {
            source: "populate-search-index",
            action: "cross_page_reconcile",
            extraction_version: EXTRACTION_VERSION,
          },
        });
        continue;
      }
      const sizes = new Set(onRebar.map((s) => s.size).filter(Boolean) as string[]);
      if (sizes.size > 1) {
        const note = `Bar mark "${mark}" has conflicting sizes across sheets: ${[...sizes].join(" vs ")}`;
        conflicts.push(note);
        await supabase.from("reconciliation_records").insert({
          user_id: userId,
          project_id,
          issue_type: "BAR_MARK_SIZE_CONFLICT",
          notes: note,
          candidates: { mark, sizes: [...sizes], sightings: onRebar },
          automated_reasoning: {
            source: "populate-search-index",
            action: "cross_page_reconcile",
            extraction_version: EXTRACTION_VERSION,
          },
        });
      }
    }

    if (rebarProjectFileId && doc_sha256) {
      await supabase
        .schema("rebar")
        .from("project_files")
        .update({ checksum_sha256: doc_sha256 })
        .eq("id", rebarProjectFileId);
    }

    console.info("[populate-search-index] indexing completed", {
      project_id,
      document_version_id: document_version_id || null,
      indexed,
      skipped,
      total: pages.length,
      discipline_counts: disciplineCounts,
      errors,
    });

    return new Response(
      JSON.stringify({
        indexed,
        skipped,
        total: pages.length,
        conflicts,
        quality_issues: qualityIssues,
        errors,
        discipline_counts: disciplineCounts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("populate-search-index error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
