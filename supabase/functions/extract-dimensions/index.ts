import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-pro";

// Required geometry fields by segment type. Anything else is optional.
const REQUIRED_FIELDS: Record<string, string[]> = {
  footings: ["length_m", "width_m", "thickness_m"],
  walls:    ["length_m", "height_m", "thickness_m"],
  slabs:    ["area_m2", "thickness_m"],
  piers:    ["count", "section_w_m", "section_h_m", "height_m"],
  columns:  ["count", "section_w_m", "section_h_m", "height_m"],
  beams:    ["length_m", "section_w_m", "section_h_m"],
  miscellaneous: [],
};

function classify(name: string, type: string): string {
  const k = `${type} ${name}`.toLowerCase();
  if (/footing|fdn|foundation pad/.test(k)) return "footings";
  if (/wall/.test(k)) return "walls";
  if (/slab|sog|on.?grade/.test(k)) return "slabs";
  if (/pier/.test(k)) return "piers";
  if (/column/.test(k)) return "columns";
  if (/beam|grade.?beam|lintel/.test(k)) return "beams";
  return "miscellaneous";
}

function buildPrompt(segments: any[], ocrText: string): string {
  const segLines = segments.map(s =>
    `- id=${s.id} name="${s.name}" type=${s.segment_type} required=[${(REQUIRED_FIELDS[classify(s.name, s.segment_type)] || []).join(", ")}]`
  ).join("\n");
  return `You are a structural-drawing dimension extractor. Read ONLY dimensions that are explicitly written on the drawings. Never scale, never approximate. If a value is not directly stated, return null.

SEGMENTS:
${segLines}

OCR TEXT (concatenated, with page markers):
${ocrText}

Return a single JSON object:
{
  "segments": [
    {
      "id": "<segment uuid>",
      "geometry": { "<field>": <number|null>, ... },     // values in meters or count
      "sources": [{ "page": <int>, "snippet": "<short quote>" }],
      "missing_fields": ["<field>", ...],
      "confidence": 0.0-1.0,
      "notes": "<one-line engineering note, optional>"
    }
  ]
}
No prose, no markdown, JSON only.`;
}

function buildKnowledgePayload(projectId: string, segments: any[]) {
  return {
    project_id: projectId,
    extracted_at: new Date().toISOString(),
    segments: segments.map((seg) => ({
      id: seg.id,
      name: seg.name,
      status: seg.status,
      geometry: seg.geometry,
      missing_fields: seg.missing_fields,
      sources: seg.sources,
      confidence: seg.confidence,
      notes: seg.notes,
    })),
  };
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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;

    const supabase = createClient(SUPABASE_URL, SR);
    const anonClient = createClient(SUPABASE_URL, ANON);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const project_id: string | undefined = body.project_id;
    const only_segment_id: string | undefined = body.segment_id;
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch segments
    let segQ = supabase.from("segments").select("id, name, segment_type, dimensions_status").eq("project_id", project_id).eq("user_id", user.id);
    if (only_segment_id) segQ = segQ.eq("id", only_segment_id);
    const { data: segments, error: segErr } = await segQ;
    if (segErr) throw segErr;
    if (!segments || segments.length === 0) {
      return new Response(JSON.stringify({ status: "no_segments", segments: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch OCR text (paginated label so the model can cite pages)
    const { data: ocrRows } = await supabase
      .from("drawing_search_index")
      .select("page_number, raw_text")
      .eq("project_id", project_id)
      .order("page_number");
    const ocrText = (ocrRows ?? [])
      .map((r: any) => `\n=== PAGE ${r.page_number} ===\n${(r.raw_text || "").slice(0, 4000)}`)
      .join("\n")
      .slice(0, 120_000); // hard cap for prompt size

    // Single Gemini call covering all segments
    const prompt = buildPrompt(segments, ocrText);
    const aiRes = await fetch(LOVABLE_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You extract construction-drawing dimensions verbatim. Output JSON only. Never invent values." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      throw new Error(`AI gateway ${aiRes.status}: ${txt.slice(0, 400)}`);
    }
    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    const results = Array.isArray(parsed?.segments) ? parsed.segments : [];

    // Apply: write geometry into estimate_items.assumptions_json (or a placeholder row),
    // and update segments.dimensions_status.
    const summary: any[] = [];
    for (const seg of segments) {
      const r = results.find((x: any) => x.id === seg.id) || {};
      const geometry = r.geometry || {};
      const required = REQUIRED_FIELDS[classify(seg.name, seg.segment_type)] || [];
      const filled = required.filter((f) => geometry[f] !== null && geometry[f] !== undefined);
      const missing = required.filter((f) => geometry[f] === null || geometry[f] === undefined);
      const status = required.length === 0
        ? "partial"  // no rule => still needs human confirmation
        : (filled.length === required.length ? "complete" : (filled.length > 0 ? "partial" : "pending"));

      // Stamp geometry on existing estimate_items for the segment (if any)
      const { data: items } = await supabase
        .from("estimate_items")
        .select("id, assumptions_json")
        .eq("segment_id", seg.id)
        .eq("user_id", user.id);
      for (const it of items ?? []) {
        const existing = (it as any).assumptions_json || {};
        await supabase.from("estimate_items").update({
          assumptions_json: { ...existing, geometry, dimension_sources: r.sources || [], dimension_confidence: r.confidence ?? 0 },
        }).eq("id", (it as any).id).eq("user_id", user.id);
      }

      // Update segment status (only auto-set complete; otherwise keep as partial/pending so user can review)
      const update: any = { dimensions_status: status };
      if (status === "complete") {
        update.dimensions_locked_at = new Date().toISOString();
        update.dimensions_locked_by = user.id;
      }
      await supabase.from("segments").update(update).eq("id", seg.id).eq("user_id", user.id);

      summary.push({
        id: seg.id,
        name: seg.name,
        status,
        geometry,
        missing_fields: missing,
        sources: r.sources || [],
        confidence: r.confidence ?? 0,
        notes: r.notes || null,
      });
    }

    const knowledgeTitle = `Project Dimensions (${project_id.slice(0, 8)})`;
    const knowledgePath = `projects/${project_id}/dimensions.json`;
    const knowledgeContent = JSON.stringify(buildKnowledgePayload(project_id, summary), null, 2);
    const { data: existingKnowledge } = await supabase
      .from("agent_knowledge")
      .select("id")
      .eq("user_id", user.id)
      .eq("type", "project_dimensions")
      .eq("file_path", knowledgePath)
      .maybeSingle();
    if (existingKnowledge?.id) {
      await supabase.from("agent_knowledge").update({
        title: knowledgeTitle,
        content: knowledgeContent,
        file_name: "dimensions.json",
      }).eq("id", existingKnowledge.id).eq("user_id", user.id);
    } else {
      await supabase.from("agent_knowledge").insert({
        user_id: user.id,
        type: "project_dimensions",
        title: knowledgeTitle,
        file_name: "dimensions.json",
        file_path: knowledgePath,
        content: knowledgeContent,
      });
    }

    await supabase.from("audit_events").insert({
      user_id: user.id,
      project_id,
      entity_type: "project",
      entity_id: project_id,
      action: "dimensions_extracted",
      metadata: {
        segment_count: summary.length,
        complete_count: summary.filter((seg) => seg.status === "complete").length,
        partial_count: summary.filter((seg) => seg.status === "partial").length,
        pending_count: summary.filter((seg) => seg.status === "pending").length,
        knowledge_path: knowledgePath,
      },
    });

    return new Response(JSON.stringify({ status: "ok", segments: summary }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});