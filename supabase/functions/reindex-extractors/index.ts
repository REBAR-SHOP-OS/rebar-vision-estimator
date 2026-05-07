import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXTRACTION_VERSION = "2026.05.07";

function preCleanOcr(text: string): string {
  let t = text.replace(/[–—]/g, "-");
  t = t.replace(/\b(\d)\s+(\d)\s*M\b/g, "$1$2M");
  t = t.replace(/#\s+(\d)/g, "#$1");
  t = t.replace(/(\d)\s+M\b/g, "$1M");
  return t;
}
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
  const reMetric = /(\d{1,3})\s*-\s*(\d{2})M\s*@\s*(\d{2,4})\s*(?:mm|MM|o\.?c\.?|c\/c)?/g;
  while ((m = reMetric.exec(text)) !== null) {
    push({ qty: +m[1], size: `${m[2]}M`, spacing: +m[3], spacing_unit: "mm", placement: detectPlacement(tailOf(m.index, m[0].length)), raw: m[0] });
  }
  const reMetricNoQty = /\b(\d{2})M\s*@\s*(\d{2,4})\s*(?:mm|MM|o\.?c\.?|c\/c)?/g;
  while ((m = reMetricNoQty.exec(text)) !== null) {
    push({ size: `${m[1]}M`, spacing: +m[2], spacing_unit: "mm", placement: detectPlacement(tailOf(m.index, m[0].length)), raw: m[0] });
  }
  const reImp = /(\d{1,3})\s*-\s*#(\d{1,2})\s*@\s*(\d+(?:\.\d+)?)\s*(?:"|in|''|o\.?c\.?|c\/c)?/gi;
  while ((m = reImp.exec(text)) !== null) {
    push({ qty: +m[1], size: `#${m[2]}`, spacing: +m[3], spacing_unit: "in", placement: detectPlacement(tailOf(m.index, m[0].length)), raw: m[0] });
  }
  const reCont = /(?:(\d{1,3})\s*-\s*)?(\d{2})M\s+(?:CONT|CONTINUOUS)\b/gi;
  while ((m = reCont.exec(text)) !== null) {
    push({ qty: m[1] ? +m[1] : null, size: `${m[2]}M`, placement: "CONT", raw: m[0] });
  }
  const reTies = /(\d{2})M\s+(TIES?|STIRR(?:UPS?)?|DWLS?|DOWELS?)\s*@\s*(\d{2,4})/gi;
  while ((m = reTies.exec(text)) !== null) {
    const u = m[2].toUpperCase();
    const placement = u.startsWith("TIE") ? "TIES" : u.startsWith("STIRR") ? "STIRR" : "DWL";
    push({ size: `${m[1]}M`, spacing: +m[3], spacing_unit: "mm", placement, raw: m[0] });
  }
  const reTiesBare = /\b(\d{2})M\s+(TIES?|STIRR(?:UPS?)?|DWLS?|DOWELS?)\b(?!\s*@)/gi;
  while ((m = reTiesBare.exec(text)) !== null) {
    const u = m[2].toUpperCase();
    const placement = u.startsWith("TIE") ? "TIES" : u.startsWith("STIRR") ? "STIRR" : "DWL";
    push({ size: `${m[1]}M`, placement, raw: m[0] });
  }
  const reQtyPlace = /(\d{1,3})\s*-\s*(\d{2})M\s+(TOP|BOT(?:TOM)?|EW|EF|T\s*&\s*B|CONT(?:INUOUS)?)\b/gi;
  while ((m = reQtyPlace.exec(text)) !== null) {
    const placement = detectPlacement(m[3]) || m[3].toUpperCase();
    push({ qty: +m[1], size: `${m[2]}M`, placement, raw: m[0] });
  }
  const reBundle = /\(?\s*(\d)\s*\)?\s*-\s*(\d{2})M(?:\s+BUNDLE)?/g;
  while ((m = reBundle.exec(text)) !== null) {
    const tail = tailOf(m.index, m[0].length).toUpperCase();
    const explicit = /BUNDLE/.test(m[0].toUpperCase()) || /\bBUNDLE\b/.test(tail);
    if (!explicit && +m[1] > 1) continue;
    push({ qty: +m[1], size: `${m[2]}M`, bundled: true, raw: m[0] });
  }
  return out;
}

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
  // Cover — explicit phrasings
  const reCover = /(\d{2,3})\s*MM\s+(BOTTOM|TOP|SIDE|EARTH|SOFFIT|EXPOSED|CLEAR)/g;
  while ((m = reCover.exec(text)) !== null) {
    const where = m[2]; const v = +m[1];
    if (where === "BOTTOM" || where === "SOFFIT") specs.cover.bottom_mm = v;
    else if (where === "TOP") specs.cover.top_mm = v;
    else if (where === "SIDE" || where === "EXPOSED") specs.cover.side_mm = v;
    else if (where === "EARTH") specs.cover.against_earth_mm = v;
    else if (where === "CLEAR") specs.cover.clear_mm = v;
    specs.detected_keywords.push(`cover:${where}=${v}`);
  }
  // "CLEAR COVER 40MM" / "MIN. COVER = 50 MM" / "MINIMUM CONCRETE COVER 75MM"
  const reCover2 = /(?:CLEAR|MIN(?:IMUM)?\.?|MINIMUM\s+CONCRETE)\s+COVER[\s:=]+(\d{2,3})\s*MM/g;
  while ((m = reCover2.exec(text)) !== null) {
    specs.cover.clear_mm = +m[1];
    specs.detected_keywords.push(`cover:clear=${m[1]}`);
  }
  const reLap = /(TENSION|COMPRESSION)\s+LAP\s*=?\s*(\d{2,3})\s*DB/g;
  while ((m = reLap.exec(text)) !== null) {
    if (m[1] === "TENSION") specs.lap.tension_db = +m[2]; else specs.lap.compression_db = +m[2];
    specs.detected_keywords.push(`lap:${m[1]}=${m[2]}db`);
  }
  // "CLASS A/B SPLICE", "40 BAR DIAMETERS", plain "LAP = 40 DB"
  const reLapBare = /\bLAP\s*[:=]?\s*(\d{2,3})\s*(?:DB|BAR\s*DIA(?:METER)?S?)/g;
  while ((m = reLapBare.exec(text)) !== null) {
    specs.lap.tension_db = specs.lap.tension_db ?? +m[1];
    specs.detected_keywords.push(`lap:db=${m[1]}`);
  }
  const reClass = /\bCLASS\s+([AB])\s+(?:LAP\s+)?SPLICE/g;
  while ((m = reClass.exec(text)) !== null) {
    specs.lap.splice_class = m[1];
    specs.detected_keywords.push(`lap:class=${m[1]}`);
  }
  if (/MECHANICAL\s+COUPLER/.test(text)) specs.lap.splice_type = "mechanical";
  else if (/WELDED\s+SPLICE/.test(text)) specs.lap.splice_type = "welded";
  else if (/LAP\s+SPLICE/.test(text)) specs.lap.splice_type = "lap";
  const reHook = /(STD|STANDARD|SEISMIC)\s+HOOK\s*=?\s*(90|135|180)/g;
  while ((m = reHook.exec(text)) !== null) {
    if (m[1] === "SEISMIC") specs.hook.seismic_deg = +m[2]; else specs.hook.standard_deg = +m[2];
    specs.detected_keywords.push(`hook:${m[1]}=${m[2]}`);
  }
  const reFy = /\b(?:FY|YIELD\s+STRENGTH)\s*[:=]?\s*(\d{2,3})\s*(MPA|KSI)?/g;
  while ((m = reFy.exec(text)) !== null) {
    const v = +m[1];
    if (m[2] === "KSI" || (!m[2] && v <= 80)) specs.grade.fy_ksi = v; else specs.grade.fy_mpa = v;
    specs.detected_keywords.push(`grade:fy=${v}${m[2] || "MPA"}`);
  }
  const reMark = /\b(400W|400R|500W|GRADE\s*60|GRADE\s*75|G30\.18[A-Z0-9.\-]*)\b/g;
  while ((m = reMark.exec(text)) !== null) {
    const mk = m[1].replace(/\s+/g, " ");
    specs.grade.mark = mk;
    specs.detected_keywords.push(`grade:${mk}`);
  }
  // Concrete strength per element-bucket: "FOOTINGS ... 25 MPA", "BEAMS ... 35 MPA"
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
  const reExp = /\b(C-?XL|C-?[12]|F-?[12]|N|S-?[123]|A-?[123]|R-?[12])\b/g;
  const seenExp = new Set<string>();
  while ((m = reExp.exec(text)) !== null) {
    const c = m[1].replace(/-/g, "");
    if (c === "N" && !/(?:CLASS|EXPOSURE)\s*N\b/.test(text.slice(Math.max(0, m.index - 20), m.index + 5))) continue;
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
  // Geotech bearing — SLS/ULS may appear before or after kPa value
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

function extractDimensions(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
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

function extractBarSchedule(text: string): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/);
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
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
  const parseHeader = (line: string): string[] | null => {
    const u = line.toUpperCase().trim();
    const cells = u.split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
    if (cells.length < 3) return null;
    const cols: string[] = []; let hits = 0;
    for (const cell of cells) {
      const key = COL_TOKENS[cell] ?? null;
      cols.push(key ?? "_"); if (key) hits++;
    }
    if (hits < 3) return null;
    if (!cols.includes("mark") && !cols.includes("size")) return null;
    return cols;
  };
  const parseRow = (line: string) => line.trim().split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
  const isMark = (s: string) => /^[A-Z]{1,3}\d{1,4}[A-Z]?$/i.test(s);
  const isSize = (s: string) => /^(?:\d{1,2}M|#\d{1,2})$/i.test(s);
  for (let i = 0; i < lines.length; i++) {
    const cols = parseHeader(lines[i]);
    if (!cols) continue;
    const end = Math.min(i + 200, lines.length);
    for (let j = i + 1; j < end; j++) {
      const cells = parseRow(lines[j]);
      if (cells.length < 2) continue;
      const row: Record<string, string | number> = {};
      for (let k = 0; k < Math.min(cells.length, cols.length); k++) {
        const name = cols[k]; if (name === "_") continue;
        row[name] = cells[k];
      }
      const mark = String(row.mark ?? ""); const size = String(row.size ?? "");
      if (!isMark(mark) && !isSize(size)) continue;
      if (size && !isSize(size)) continue;
      for (const k of ["qty","length","spacing","weight","a","b","c","d","e","r"]) {
        const v = row[k]; if (typeof v === "string" && /^\d/.test(v)) {
          const n = Number(v); if (!Number.isNaN(n)) row[k] = n;
        }
      }
      if (row.length == null) {
        const sum = ["a","b","c","d","e"].map((k) => typeof row[k] === "number" ? (row[k] as number) : 0).reduce((s,n)=>s+n,0);
        if (sum > 0) { row.length = sum; row.length_computed = true; }
      }
      if (typeof row.shape === "string") row.shape = row.shape.toUpperCase();
      const k = `${mark}|${size}|${row.length ?? ""}|${row.qty ?? ""}|${row.shape ?? ""}`;
      if (seen.has(k)) continue; seen.add(k);
      if (Object.keys(row).length < 2) continue;
      out.push(row);
      if (out.length > 200) break;
    }
    if (out.length > 0) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), { status: 400, headers: corsHeaders });
    }

    const { data: rows, error } = await supabase
      .from("drawing_search_index")
      .select("id, raw_text, extracted_entities")
      .eq("user_id", userId)
      .eq("project_id", project_id);
    if (error) throw error;

    let updated = 0;
    let totalCallouts = 0;
    let totalDims = 0;
    let totalRows = 0;
    let totalSpecKeywords = 0;
    let bestSpecsPage: { page_id: string; specs: Record<string, unknown>; hits: number } | null = null;
    for (const r of rows || []) {
      const text = (r as any).raw_text || "";
      const callouts = extractBarCallouts(text);
      const dims = extractDimensions(text);
      const schedule = extractBarSchedule(text);
      const specs = extractSpecs(text);
      const specHits = Array.isArray((specs as any).detected_keywords) ? (specs as any).detected_keywords.length : 0;
      totalSpecKeywords += specHits;
      if (specHits > 0 && (!bestSpecsPage || specHits > bestSpecsPage.hits)) {
        bestSpecsPage = { page_id: (r as any).id, specs, hits: specHits };
      }
      totalCallouts += callouts.length;
      totalDims += dims.length;
      totalRows += schedule.length;
      const ext = ((r as any).extracted_entities && typeof (r as any).extracted_entities === "object")
        ? (r as any).extracted_entities : {};
      const next = {
        ...ext,
        bar_callouts: callouts,
        dimensions: dims,
        bar_schedule_rows: schedule,
        specs,
      };
      const { error: upErr } = await supabase
        .from("drawing_search_index")
        .update({ extracted_entities: next, extraction_version: EXTRACTION_VERSION })
        .eq("id", (r as any).id);
      if (!upErr) updated++;
    }

    if (bestSpecsPage) {
      await supabase.from("audit_events").insert({
        user_id: userId,
        project_id,
        entity_type: "project",
        action: "spec_extracted",
        metadata: {
          specs: bestSpecsPage.specs,
          source_page_id: bestSpecsPage.page_id,
          hits: bestSpecsPage.hits,
          extraction_version: EXTRACTION_VERSION,
        },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      pages_scanned: rows?.length || 0,
      pages_updated: updated,
      bar_callouts: totalCallouts,
      dimensions: totalDims,
      schedule_rows: totalRows,
      spec_keywords: totalSpecKeywords,
      specs_authoritative_page: bestSpecsPage?.page_id || null,
      extraction_version: EXTRACTION_VERSION,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("reindex-extractors error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});