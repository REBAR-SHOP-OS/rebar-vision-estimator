import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "google/gemini-3.1-flash-image-preview";
const OPENAI_MODEL = "gpt-image-1";
const MAX_SEGMENTS = 3;

interface BarItem {
  mark: string | null;
  size: string | null;
  quantity: number | null;
  shape_code: string | null;
  cut_length: number | null;
}

interface Segment {
  id: string;
  name: string;
  segment_type: string | null;
  level_label: string | null;
  zone_label: string | null;
  notes: string | null;
}

function buildPrompt(seg: Segment, bars: BarItem[], projectName: string): string {
  const summary = bars.slice(0, 25).map((b) => {
    const parts = [
      b.mark ? `Mark ${b.mark}` : null,
      b.size ? `${b.size}` : null,
      b.quantity ? `qty ${b.quantity}` : null,
      b.shape_code ? `shape ${b.shape_code}` : null,
      b.cut_length ? `L=${b.cut_length}mm` : null,
    ].filter(Boolean);
    return `- ${parts.join(", ")}`;
  }).join("\n");

  const sizes = Array.from(new Set(bars.map((b) => b.size).filter(Boolean))).join(", ");
  const marks = Array.from(new Set(bars.map((b) => b.mark).filter(Boolean))).slice(0, 12).join(", ");

  return [
    `Generate a clean engineering shop-drawing sketch for project "${projectName}".`,
    `Segment: ${seg.name}${seg.level_label ? ` (level ${seg.level_label})` : ""}${seg.zone_label ? ` zone ${seg.zone_label}` : ""}.`,
    `Type: ${seg.segment_type || "structural element"}.`,
    `Show a top-down orthographic plan view of the rebar layout with bar callouts.`,
    `Include bar marks: ${marks || "as listed"}.`,
    `Bar sizes used: ${sizes || "metric"}.`,
    `Bar list (subset):\n${summary || "(no bar items)"}`,
    `Style: black & white technical line drawing on white background, dimensioned, with a small bar list/legend table on the right side.`,
    `No shading, no perspective, no color fills. Crisp clean lines like a CAD shop drawing.`,
  ].join("\n");
}

async function generateImageOpenAI(prompt: string, apiKey: string): Promise<string | null> {
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      prompt,
      size: "1024x1024",
      n: 1,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err: any = new Error(`OpenAI image error ${resp.status}: ${text}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return `data:image/png;base64,${b64}`;
  const url = data?.data?.[0]?.url;
  return typeof url === "string" ? url : null;
}

async function generateImage(prompt: string, apiKey: string): Promise<string | null> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err: any = new Error(`AI gateway error ${resp.status}: ${text}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const url = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  return typeof url === "string" ? url : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { projectId, segmentId, provider } = await req.json();
    const useOpenAI = provider === "openai";
    if (useOpenAI && !openaiKey) throw new Error("OPENAI_API_KEY not configured");
    if (!useOpenAI && !lovableKey) throw new Error("LOVABLE_API_KEY not configured");
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project } = await supabase
      .from("projects")
      .select("name, client_name")
      .eq("id", projectId)
      .single();

    let segQuery = supabase
      .from("segments")
      .select("id, name, segment_type, level_label, zone_label, notes")
      .eq("project_id", projectId);
    if (segmentId) segQuery = segQuery.eq("id", segmentId);
    const { data: segments } = await segQuery;

    const segs = (segments || []) as Segment[];
    if (segs.length === 0) {
      return new Response(JSON.stringify({ error: "No segments found for this project" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const segIds = segs.map((s) => s.id);
    const { data: bars } = await supabase
      .from("bar_items")
      .select("segment_id, mark, size, quantity, shape_code, cut_length")
      .in("segment_id", segIds);

    const barsBySeg = new Map<string, BarItem[]>();
    for (const b of (bars || []) as any[]) {
      const list = barsBySeg.get(b.segment_id) || [];
      list.push(b);
      barsBySeg.set(b.segment_id, list);
    }

    const segsWithBars = segs.filter((s) => (barsBySeg.get(s.id) || []).length > 0).slice(0, MAX_SEGMENTS);
    const targets = segsWithBars.length > 0 ? segsWithBars : segs.slice(0, MAX_SEGMENTS);

    const projectName = project?.name || "Rebar Project";
    type ResultRow = { segment_id: string; segment_name: string; image_data_uri: string | null; caption: string; error?: string };
    let rateLimitStatus: number | null = null;

    const settled = await Promise.all(targets.map(async (seg): Promise<ResultRow> => {
      const segBars = barsBySeg.get(seg.id) || [];
      const prompt = buildPrompt(seg, segBars, projectName);
      try {
        const url = useOpenAI
          ? await generateImageOpenAI(prompt, openaiKey!)
          : await generateImage(prompt, lovableKey!);
        return {
          segment_id: seg.id,
          segment_name: seg.name,
          image_data_uri: url,
          caption: `${seg.name} — ${segBars.length} bar item(s)`,
        };
      } catch (e: any) {
        if (e?.status === 429 || e?.status === 402) rateLimitStatus = e.status;
        return {
          segment_id: seg.id,
          segment_name: seg.name,
          image_data_uri: null,
          caption: seg.name,
          error: e?.message || "generation failed",
        };
      }
    }));

    if (rateLimitStatus === 429 || rateLimitStatus === 402) {
      return new Response(
        JSON.stringify({
          error: rateLimitStatus === 429
            ? "AI rate limit reached, please wait a moment and try again."
            : "AI credits exhausted. Add funds in Settings → Workspace → Usage.",
        }),
        { status: rateLimitStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = settled;

    console.log(JSON.stringify({
      route: "draft-shop-drawing-ai",
      project_id: projectId,
      pinned_model: useOpenAI ? OPENAI_MODEL : MODEL,
      provider: useOpenAI ? "openai" : "lovable",
      segments_requested: targets.length,
      images_generated: results.filter((r) => r.image_data_uri).length,
    }));

    return new Response(
      JSON.stringify({
        project_name: projectName,
        client_name: project?.client_name || "",
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("draft-shop-drawing-ai error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});