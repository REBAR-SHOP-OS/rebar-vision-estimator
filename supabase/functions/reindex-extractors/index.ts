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
  const specs: Record<string, any> = { cover: {}, lap: {}, hook: {}, grade: {}, detected_keywords: [] as string[] };
  let m: RegExpExecArray | null;
  const reCover = /(\d{2,3})\s*MM\s+(BOTTOM|TOP|SIDE|EARTH|SOFFIT|EXPOSED)/g;
  while ((m = reCover.exec(text)) !== null) {
    const where = m[2]; const v = +m[1];
    if (where === "BOTTOM" || where === "SOFFIT") specs.cover.bottom_mm = v;
    else if (where === "TOP") specs.cover.top_mm = v;
    else if (where === "SIDE" || where === "EXPOSED") specs.cover.side_mm = v;
    else if (where === "EARTH") specs.cover.against_earth_mm = v;
    specs.detected_keywords.push(`cover:${where}=${v}`);
  }
  const reLap = /(TENSION|COMPRESSION)\s+LAP\s*=?\s*(\d{2,3})\s*DB/g;
  while ((m = reLap.exec(text)) !== null) {
    if (m[1] === "TENSION") specs.lap.tension_db = +m[2]; else specs.lap.compression_db = +m[2];
    specs.detected_keywords.push(`lap:${m[1]}=${m[2]}db`);
  }
  if (/MECHANICAL\s+COUPLER/.test(text)) specs.lap.splice_type = "mechanical";
  else if (/WELDED\s+SPLICE/.test(text)) specs.lap.splice_type = "welded";
  else if (/LAP\s+SPLICE/.test(text)) specs.lap.splice_type = "lap";
  const reHook = /(STD|STANDARD|SEISMIC)\s+HOOK\s*=?\s*(90|135|180)/g;
  while ((m = reHook.exec(text)) !== null) {
    if (m[1] === "SEISMIC") specs.hook.seismic_deg = +m[2]; else specs.hook.standard_deg = +m[2];
    specs.detected_keywords.push(`hook:${m[1]}=${m[2]}`);
  }
  const reFy = /(?:FY|GRADE)\s*=?\s*(\d{2,3})\s*(MPA|KSI)?/g;
  while ((m = reFy.exec(text)) !== null) {
    const v = +m[1];
    if (m[2] === "KSI" || (!m[2] && v <= 80)) specs.grade.fy_ksi = v; else specs.grade.fy_mpa = v;
    specs.detected_keywords.push(`grade:fy=${v}${m[2] || "MPA"}`);
  }
  const reMark = /\b(400W|500W|GRADE\s*60|GRADE\s*75)\b/g;
  while ((m = reMark.exec(text)) !== null) {
    specs.grade.mark = m[1].replace(/\s+/g, " ");
    specs.detected_keywords.push(`grade:${specs.grade.mark}`);
  }
  return specs;
}

function extractDimensions(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const push = (v: number, raw: string) => {
    if (v < 100 || v > 200_000) return;
    const k = `${v}|${raw}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ value_mm: Math.round(v), raw });
  };
  let m: RegExpExecArray | null;
  const reMm = /\b(\d{3,5})\s*(?:mm|MM)\b/g;
  while ((m = reMm.exec(text)) !== null) push(+m[1], m[0]);
  const reM = /\b(\d{1,3}(?:\.\d{1,3})?)\s*m\b(?!m)/g;
  while ((m = reM.exec(text)) !== null) push(parseFloat(m[1]) * 1000, m[0]);
  const reFt = /\b(\d{1,3})['′]\s*[-–]?\s*(\d{1,2})?\s*["″]?/g;
  while ((m = reFt.exec(text)) !== null) {
    const ft = +m[1];
    const inch = m[2] ? +m[2] : 0;
    push((ft * 12 + inch) * 25.4, m[0]);
  }
  return out.slice(0, 500);
}

function extractBarSchedule(text: string): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/);
  const out: Array<Record<string, unknown>> = [];
  const headerKeys = ["MARK", "SIZE", "LENGTH", "QTY", "QUANTITY", "SHAPE", "BAR", "WEIGHT", "SPACING"];
  const rowRe = /^([A-Z]{1,2}\d{1,3})\s+(\d{1,2}M|#\d{1,2})\s+(\d+(?:\.\d+)?)\s+(\d{1,4})/;
  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].toUpperCase();
    const hits = headerKeys.filter((k) => upper.includes(k)).length;
    if (hits < 3) continue;
    const end = Math.min(i + 80, lines.length);
    for (let j = i + 1; j < end; j++) {
      const r = lines[j].match(rowRe);
      if (r) out.push({ mark: r[1], size: r[2], length: parseFloat(r[3]), qty: +r[4] });
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
    for (const r of rows || []) {
      const text = (r as any).raw_text || "";
      const callouts = extractBarCallouts(text);
      const dims = extractDimensions(text);
      const schedule = extractBarSchedule(text);
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
      };
      const { error: upErr } = await supabase
        .from("drawing_search_index")
        .update({ extracted_entities: next, extraction_version: EXTRACTION_VERSION })
        .eq("id", (r as any).id);
      if (!upErr) updated++;
    }

    return new Response(JSON.stringify({
      ok: true,
      pages_scanned: rows?.length || 0,
      pages_updated: updated,
      bar_callouts: totalCallouts,
      dimensions: totalDims,
      schedule_rows: totalRows,
      extraction_version: EXTRACTION_VERSION,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("reindex-extractors error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});