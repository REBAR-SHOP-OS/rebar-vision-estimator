import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Rebar mass table (kg/m) — used for synthetic weight when consensus locks size+length ──
const BAR_MASS_KG_M: Record<string, number> = {
  "10M": 0.785, "15M": 1.570, "20M": 2.355, "25M": 3.925, "30M": 5.495, "35M": 7.850,
  "#3": 0.561, "#4": 0.994, "#5": 1.552, "#6": 2.235, "#7": 3.042, "#8": 3.973,
};

function normalizeSize(raw: string): string {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "");
  if (/^\d+M$/.test(s)) return s;
  if (/^#\d+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return `${s}M`;
  return s;
}

async function callGateway(model: string, system: string, user: string, apiKey: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${model} ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content || "";
}

function parseJsonArray(raw: string): any[] {
  const cleaned = String(raw || "").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  // Try direct parse first
  try {
    const v = JSON.parse(cleaned);
    if (Array.isArray(v)) return v;
  } catch { /* try extraction */ }
  // Extract first [...] block
  const m = cleaned.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const v = JSON.parse(m[0]);
      if (Array.isArray(v)) return v;
    } catch { /* ignore */ }
  }
  return [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { segment_id, project_id } = await req.json();
    if (!segment_id || !project_id) {
      return new Response(JSON.stringify({ error: "segment_id and project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [segRes, projRes, estRes, existingRes, stdRes, searchIndexRes] = await Promise.all([
      supabase.from("segments").select("*").eq("id", segment_id).single(),
      supabase.from("projects").select("name, project_type, scope_items").eq("id", project_id).single(),
      supabase.from("estimate_items").select("id, description, bar_size, quantity_count, total_length, total_weight, assumptions_json").eq("segment_id", segment_id).limit(50),
      supabase.from("bar_items").select("mark, size").eq("segment_id", segment_id).limit(50),
      supabase.from("standards_profiles").select("*").eq("user_id", user.id).eq("is_default", true).limit(1),
      supabase.from("drawing_search_index").select("raw_text, page_number").eq("project_id", project_id).limit(50),
    ]);

    const segment = segRes.data;
    if (!segment) {
      return new Response(JSON.stringify({ error: "Segment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const project = projRes.data;
    const rawEstimateItems = estRes.data || [];
    // De-dup duplicate estimate rows (same description + bar_size) so we don't
    // emit two BS marks for the same physical bar set.
    const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const seen = new Map<string, any>();
    for (const it of rawEstimateItems as any[]) {
      const key = `${norm(it.description || "")}|${(it.bar_size || "").toUpperCase().trim()}`;
      const prev = seen.get(key);
      if (!prev || (Number(it.total_weight) || 0) > (Number(prev.total_weight) || 0)) seen.set(key, it);
    }
    const estimateItems = Array.from(seen.values());
    const existingBars = existingRes.data || [];
    const standard = stdRes.data?.[0];

    const searchPages = searchIndexRes.data || [];

    if (estimateItems.length === 0) {
      return new Response(JSON.stringify({ error: "No estimate items found. Run Auto Estimate first." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingMarks = existingBars.map((b: any) => b.mark).filter(Boolean).join(", ");

    // ── Engine #1: Google Vision OCR (already in drawing_search_index) — authoritative for NUMBERS ──
    let drawingTextContext = "";
    if (searchPages.length > 0) {
      const snippets: string[] = [];
      for (const page of searchPages) {
        const text = (page.raw_text || "").trim();
        if (text.length > 20) {
          snippets.push(`[Page ${page.page_number}] ${text.substring(0, 2500)}`);
        }
      }
      drawingTextContext = snippets.join("\n\n").slice(0, 12000);
    }

    // ── Triple-engine consensus prompt ──
    // Same prompt sent to Gemini AND GPT-5; Google Vision text above is the authoritative number source.
    const systemPrompt = `You are a rebar detailing expert. Extract a bar schedule from the OCR drawing text below.
Rules:
- Return ONLY a JSON array, no markdown, no explanation.
- Each object MUST include "estimate_item_index": the [INDEX=N] number of the source estimate item it belongs to.
- Each object: { "mark": string, "size": string, "shape_code": string, "cut_length_mm": number, "quantity": number, "confidence": number (0-1) }
- BAR MARKS: Use ACTUAL marks from the OCR text (e.g. B1001, BS03, BD01). If absent, use sequential marks (A1, A2...).
- shape_code: one of "straight", "L-shape", "U-shape", "Z-shape", "hook", "stirrup", "closed".
- size: metric (10M/15M/20M/25M/30M/35M) or imperial (#3..#8). Normalize bare digits to ##M.
- quantity and cut_length_mm MUST be taken VERBATIM from the OCR drawing text. NEVER invent. If OCR is silent, return quantity 0 and cut_length_mm 0 with confidence <= 0.3.
- BAR-MARK PREFIX RULE: marks for STRAIGHT bars MUST start with "BS" (e.g. BS01, BS1005). Marks for any BENT shape (L/U/Z/hook/stirrup/closed) MUST start with "B" (e.g. B01, B1005). Preserve mark prefixes from the OCR text when present; otherwise assign per shape.
- Do NOT duplicate existing marks: ${existingMarks || "none yet"}.`;

    const estimateSummary = estimateItems.map((e: any, i: number) =>
      `[INDEX=${i}] ${e.description} — ${e.bar_size}, qty=${e.quantity_count}, length=${e.total_length}m, weight=${e.total_weight}kg`
    ).join("\n");

    const userPrompt = `Project: ${project?.name || "Unknown"} (${project?.project_type || "Unknown"})
Segment: ${segment.name} (${segment.segment_type})
Level: ${segment.level_label || "N/A"} | Zone: ${segment.zone_label || "N/A"}
Standards: ${standard ? `${standard.name} (${standard.code_family}, ${standard.units})` : "Default metric"}

Estimate items to detail into bar schedule:
${estimateSummary}

${drawingTextContext ? `=== GOOGLE VISION OCR (AUTHORITATIVE — extract numbers verbatim) ===\n${drawingTextContext}\n=== END OCR ===` : "(no OCR text available — return empty array)"}

Generate the bar schedule. NEVER invent quantities or lengths — if not in OCR text, return 0.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Run Gemini + GPT-5 in parallel (Engine #2 and #3) ──
    let geminiItems: any[] = [];
    let gptItems: any[] = [];
    const errors: string[] = [];
    try {
      const [geminiRaw, gptRaw] = await Promise.all([
        callGateway("google/gemini-2.5-pro", systemPrompt, userPrompt, LOVABLE_API_KEY).catch((e) => { errors.push(`gemini:${e.message}`); return ""; }),
        callGateway("openai/gpt-5", systemPrompt, userPrompt, LOVABLE_API_KEY).catch((e) => { errors.push(`gpt:${e.message}`); return ""; }),
      ]);
      geminiItems = parseJsonArray(geminiRaw);
      gptItems = parseJsonArray(gptRaw);
    } catch (e) {
      console.error("Engine call failed:", e);
    }

    if (geminiItems.length === 0 && gptItems.length === 0) {
      return new Response(JSON.stringify({ error: "All AI engines returned empty.", details: errors }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Consensus merge ──
    // Group both engines' outputs by estimate_item_index, then for each group:
    //   * mark + shape_code: require Gemini & GPT to AGREE (else low confidence + UNVERIFIED)
    //   * size + quantity + cut_length_mm: prefer values present in Google Vision OCR text
    //     (we already instructed both engines to extract verbatim — their agreement is the proxy
    //      for OCR confirmation since both saw the same OCR text)
    const byIndex = new Map<number, { gemini: any[]; gpt: any[] }>();
    for (const it of geminiItems) {
      const idx = Number(it.estimate_item_index);
      if (isNaN(idx)) continue;
      if (!byIndex.has(idx)) byIndex.set(idx, { gemini: [], gpt: [] });
      byIndex.get(idx)!.gemini.push(it);
    }
    for (const it of gptItems) {
      const idx = Number(it.estimate_item_index);
      if (isNaN(idx)) continue;
      if (!byIndex.has(idx)) byIndex.set(idx, { gemini: [], gpt: [] });
      byIndex.get(idx)!.gpt.push(it);
    }

    const merged: any[] = [];
    let unverifiedCount = 0;
    for (const [idx, { gemini, gpt }] of byIndex.entries()) {
      const linkedEi = idx >= 0 && idx < estimateItems.length ? estimateItems[idx] : null;
      const max = Math.max(gemini.length, gpt.length, 1);
      for (let i = 0; i < max; i++) {
        const g = gemini[i] || {};
        const o = gpt[i] || {};
        const gMark = String(g.mark || "").trim();
        const oMark = String(o.mark || "").trim();
        const gShape = String(g.shape_code || "").toLowerCase().trim();
        const oShape = String(o.shape_code || "").toLowerCase().trim();
        const gSize = normalizeSize(g.size || "");
        const oSize = normalizeSize(o.size || "");
        const gQty = Math.max(0, Math.round(Number(g.quantity) || 0));
        const oQty = Math.max(0, Math.round(Number(o.quantity) || 0));
        const gLen = Math.max(0, Number(g.cut_length_mm) || 0);
        const oLen = Math.max(0, Number(o.cut_length_mm) || 0);

        const markAgree = gMark && oMark && gMark === oMark;
        const shapeAgree = gShape === oShape && gShape !== "";
        const sizeAgree = gSize && oSize && gSize === oSize;
        const qtyAgree = gQty > 0 && oQty > 0 && gQty === oQty;
        const lenAgree = gLen > 0 && oLen > 0 && Math.abs(gLen - oLen) / Math.max(gLen, oLen) < 0.05;

        // Final values
        const shape = shapeAgree ? gShape : (gShape || oShape || "straight");
        const isStraight = /^straight$/i.test(shape);
        const fallbackPrefix = isStraight ? "BS" : "B";
        const mark = markAgree ? gMark : (gMark || oMark || `${fallbackPrefix}${merged.length + 1}`);
        const size = sizeAgree ? gSize : (gSize || oSize || (linkedEi?.bar_size ? normalizeSize(linkedEi.bar_size) : ""));
        const qty = qtyAgree ? gQty : (gQty || oQty || 0);
        const cut_length_mm = lenAgree ? Math.round((gLen + oLen) / 2) : (gLen || oLen || 0);

        // Per-field confidence from agreement count
        const fields = [markAgree, shapeAgree, sizeAgree, qtyAgree, lenAgree];
        const agreeCount = fields.filter(Boolean).length;
        const baseConf = agreeCount / fields.length; // 0..1
        const confidence = Math.max(0.1, Math.min(0.99, baseConf));

        if (!qtyAgree || !sizeAgree) unverifiedCount++;

        merged.push({
          estimate_item_index: idx,
          estimate_item_id: linkedEi?.id || null,
          mark,
          size,
          shape_code: shape,
          cut_length: cut_length_mm,
          quantity: qty || 1,
          confidence,
          finish_type: "black",
          cover_value: 50,
          lap_length: 0,
          consensus: {
            gemini: { mark: gMark, size: gSize, shape: gShape, qty: gQty, len: gLen },
            gpt: { mark: oMark, size: oSize, shape: oShape, qty: oQty, len: oLen },
            agree: { mark: markAgree, shape: shapeAgree, size: sizeAgree, qty: qtyAgree, length: lenAgree },
          },
        });
      }
    }

    if (merged.length === 0) {
      return new Response(JSON.stringify({ error: "No bar items could be derived from consensus." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = merged.map((item: any) => {
      return {
        segment_id,
        user_id: user.id,
        mark: String(item.mark || "").slice(0, 50),
        size: String(item.size || "").slice(0, 20),
        shape_code: String(item.shape_code || "straight").slice(0, 30),
        cut_length: Math.max(0, Number(item.cut_length) || 0),
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
        finish_type: String(item.finish_type || "black").slice(0, 20),
        cover_value: Math.max(0, Number(item.cover_value) || 0),
        lap_length: Math.max(0, Number(item.lap_length) || 0),
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
        estimate_item_id: item.estimate_item_id || null,
      };
    });

    const { data: inserted, error: insertErr } = await supabase
      .from("bar_items")
      .insert(rows)
      .select("id");

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to save bar items" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Backfill estimate_items qty/length/weight when consensus locked them ──
    // Aggregate consensus values per estimate_item_id
    const aggByEi = new Map<string, { qty: number; lenMm: number; size: string }>();
    for (const m of merged) {
      if (!m.estimate_item_id) continue;
      // Only backfill when both engines agreed on qty AND size
      if (!m.consensus.agree.qty || !m.consensus.agree.size) continue;
      const cur = aggByEi.get(m.estimate_item_id) || { qty: 0, lenMm: 0, size: m.size };
      cur.qty += Math.max(0, Number(m.quantity) || 0);
      cur.lenMm += Math.max(0, Number(m.cut_length) || 0) * Math.max(1, Number(m.quantity) || 1);
      cur.size = m.size || cur.size;
      aggByEi.set(m.estimate_item_id, cur);
    }
    let backfilled = 0;
    for (const ei of estimateItems) {
      const agg = aggByEi.get(ei.id);
      if (!agg) continue;
      const needsBackfill = (Number(ei.quantity_count) || 0) === 0 || (Number(ei.total_length) || 0) === 0 || (Number(ei.total_weight) || 0) === 0;
      if (!needsBackfill) continue;
      const totalLengthM = agg.lenMm / 1000;
      const massPerM = BAR_MASS_KG_M[normalizeSize(agg.size)] || 0;
      const totalWeight = totalLengthM * massPerM;
      const { error: upErr } = await supabase.from("estimate_items").update({
        quantity_count: agg.qty,
        total_length: Math.round(totalLengthM * 100) / 100,
        total_weight: Math.round(totalWeight * 100) / 100,
        bar_size: agg.size || ei.bar_size,
        // Bar-schedule consensus is a deterministic source — promote status.
        assumptions_json: {
          ...(ei.assumptions_json || {}),
          geometry_status: "resolved",
          resolver: "bar_schedule_consensus",
        },
      }).eq("id", ei.id);
      if (!upErr) backfilled++;
    }

    await supabase.from("audit_events").insert({
      user_id: user.id,
      project_id,
      segment_id,
      action: "auto_bar_schedule_consensus",
      entity_type: "segment",
      entity_id: segment_id,
      metadata: {
        bars_created: inserted?.length || 0,
        backfilled_estimate_items: backfilled,
        unverified_fields: unverifiedCount,
        engines: ["google-vision-ocr", "google/gemini-2.5-pro", "openai/gpt-5"],
        engine_errors: errors,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      bars_created: inserted?.length || 0,
      backfilled_estimate_items: backfilled,
      unverified_fields: unverifiedCount,
      engines_used: ["google-vision-ocr", "google/gemini-2.5-pro", "openai/gpt-5"],
      engine_errors: errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("auto-bar-schedule error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
