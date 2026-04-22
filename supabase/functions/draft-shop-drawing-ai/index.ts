import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "google/gemini-3.1-flash-image-preview";
// Latest OpenAI image model. `gpt-image-1.5` is the newest GPT image
// generator with the strongest prompt adherence for structured CAD-style sheets.
const OPENAI_MODEL = "gpt-image-1.5";
const OPENAI_FALLBACK_MODEL = "gpt-image-1";
// Planner model used to tighten the shop-drawing prompt before image render.
const OPENAI_PLANNER_MODEL = "gpt-4.1";
const OPENAI_IMAGE_SIZE = "1536x1024"; // landscape sheet aspect, matches shop-drawing layouts
const OPENAI_IMAGE_QUALITY = "high";    // high-fidelity line work for CAD-style output
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
  const segType = (seg.segment_type || "").toLowerCase();
  const isWall = /wall|shear|sw/.test(segType) || /wall|sw/i.test(seg.name);
  const isColumn = /col|column|pier|cage/.test(segType);
  const view = isWall
    ? "an orthographic ELEVATION view (vertical) with floor-level datum tags on the left (T/SLAB, T/2nd FLR, T/ROOF) and gridlines (A1, A2 …) bubbled at the top"
    : isColumn
      ? "an orthographic ELEVATION view of the column/pier with stirrup spacing, plus a small PLAN cross-section to the right"
      : "a top-down orthographic PLAN view with gridlines (A1, A2 …) bubbled along the top and (AA, AB …) bubbled on the right";

  return [
    `Produce a professional reinforced-concrete SHOP DRAWING sheet — fabrication-ready, in the style of a Rebar.Shop / Mavericks Detailing CAD plot.`,
    `Project: "${projectName}". Segment: ${seg.name}${seg.level_label ? ` (level ${seg.level_label})` : ""}${seg.zone_label ? `, zone ${seg.zone_label}` : ""}.`,
    `Element type: ${seg.segment_type || "structural element"}.`,
    ``,
    `LAYOUT — fill the full sheet, white background, landscape orientation:`,
    `• Main drawing area (left ~80% of sheet): ${view}.`,
    `• Right ~20%: title-block stack (logo placeholder "REBAR.SHOP", project name, "PART OF STRUCTURE", scale 1:50 or 1:150, drawing no. ${seg.name.toUpperCase().replace(/\s+/g, "")}, revision triangle, detailer/checker rows) and a small LEGEND box (hatched embed plate, hatched bearing-plate pocket, OWSJ bearing plate).`,
    ``,
    `DRAWING CONTENT (must be visible and crisp):`,
    `• Continuous dimension chains along top and bottom edges with numeric values in mm (e.g. 540, 2602, 7575, 3470 …).`,
    `• Grid bubbles: circles with letters/numbers (A1, A1.a, A2 … on top; AA, AA.1, AB … on right) connected by thin dashed grid lines.`,
    `• Rebar shown as solid black lines with size callouts in oval bubbles (e.g. "2x2 15M T&B ADD'L", "20M @ 200 EW").`,
    `• Bar marks to feature: ${marks || "use the supplied list"}.`,
    `• Bar sizes used (metric Canadian): ${sizes || "10M, 15M, 20M"}.`,
    `• Hatched rectangles for embed plates (red diagonal hatch) and bearing-plate pockets (blue diagonal hatch). Dashed CMU walls. No other colour.`,
    `• A floating "REVISION CLOUD" with a triangle "1" near any clouded note.`,
    ``,
    `BAR LIST (subset for context, render the major marks visually):`,
    summary || "(no bar items provided)",
    ``,
    `STYLE — non-negotiable:`,
    `• Looks like a 1:50 / 1:150 AutoCAD plot. Crisp 0.13–0.5 mm linework, monospaced/Arial Narrow text, all caps for labels.`,
    `• Pure white background, primarily black ink, with the two accent hatches above. NO 3-D, NO perspective, NO shading, NO colour fills, NO photorealism, NO hand-sketch look.`,
    `• High-resolution vector-clean lines, anti-aliased text, fully readable callouts and dimensions.`,
  ].join("\n");
}

async function refinePromptOpenAI(rawPrompt: string, apiKey: string): Promise<string> {
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_PLANNER_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a CAD detailer. Tighten this shop-drawing prompt for an image model. Preserve all bar marks, dimensions, gridlines, hatches, and title-block content. Output only the refined prompt, no preamble.",
          },
          { role: "user", content: rawPrompt },
        ],
      }),
    });
    if (!resp.ok) return rawPrompt;
    const data = await resp.json();
    const refined = data?.choices?.[0]?.message?.content;
    return typeof refined === "string" && refined.trim().length > 50 ? refined : rawPrompt;
  } catch (_e) {
    return rawPrompt;
  }
}

async function callOpenAIImage(prompt: string, apiKey: string, model: string): Promise<Response> {
  return await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: OPENAI_IMAGE_SIZE,
      quality: OPENAI_IMAGE_QUALITY,
      background: "opaque",
      n: 1,
    }),
  });
}

async function generateImageOpenAI(
  prompt: string,
  apiKey: string,
): Promise<{ url: string | null; modelUsed: string }> {
  const refined = await refinePromptOpenAI(prompt, apiKey);
  let modelUsed = OPENAI_MODEL;
  let resp = await callOpenAIImage(refined, apiKey, OPENAI_MODEL);

  // Fallback if the new model isn't available on this account
  if (resp.status === 404 || resp.status === 400) {
    const text = await resp.text();
    if (/model/i.test(text)) {
      modelUsed = OPENAI_FALLBACK_MODEL;
      resp = await callOpenAIImage(refined, apiKey, OPENAI_FALLBACK_MODEL);
    } else {
      const err: any = new Error(`OpenAI image error ${resp.status}: ${text}`);
      err.status = resp.status;
      throw err;
    }
  }

  if (!resp.ok) {
    const text = await resp.text();
    const err: any = new Error(`OpenAI image error ${resp.status}: ${text}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return { url: `data:image/png;base64,${b64}`, modelUsed };
  const url = data?.data?.[0]?.url;
  return { url: typeof url === "string" ? url : null, modelUsed };
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
    type ResultRow = { segment_id: string; segment_name: string; image_data_uri: string | null; caption: string; error?: string; model_used?: string };
    let rateLimitStatus: number | null = null;
    let lastImageModelUsed: string | null = null;

    const settled = await Promise.all(targets.map(async (seg): Promise<ResultRow> => {
      const segBars = barsBySeg.get(seg.id) || [];
      const prompt = buildPrompt(seg, segBars, projectName);
      try {
        let url: string | null;
        let modelUsed: string | undefined;
        if (useOpenAI) {
          const r = await generateImageOpenAI(prompt, openaiKey!);
          url = r.url;
          modelUsed = r.modelUsed;
          lastImageModelUsed = r.modelUsed;
        } else {
          url = await generateImage(prompt, lovableKey!);
        }
        return {
          segment_id: seg.id,
          segment_name: seg.name,
          image_data_uri: url,
          caption: `${seg.name} — ${segBars.length} bar item(s)`,
          model_used: modelUsed,
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
      planner_model: useOpenAI ? OPENAI_PLANNER_MODEL : null,
      image_model_used: useOpenAI ? (lastImageModelUsed || OPENAI_MODEL) : MODEL,
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