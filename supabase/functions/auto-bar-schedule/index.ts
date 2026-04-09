import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
      supabase.from("estimate_items").select("id, description, bar_size, quantity_count, total_length, total_weight").eq("segment_id", segment_id).limit(50),
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
    const estimateItems = estRes.data || [];
    const existingBars = existingRes.data || [];
    const standard = stdRes.data?.[0];

    const searchPages = searchIndexRes.data || [];

    if (estimateItems.length === 0) {
      return new Response(JSON.stringify({ error: "No estimate items found. Run Auto Estimate first." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingMarks = existingBars.map((b: any) => b.mark).filter(Boolean).join(", ");

    // Build drawing text context from OCR search index
    let drawingTextContext = "";
    if (searchPages.length > 0) {
      const snippets: string[] = [];
      for (const page of searchPages) {
        const text = (page.raw_text || "").trim();
        if (text.length > 20) {
          snippets.push(`[Page ${page.page_number}] ${text.substring(0, 2000)}`);
        }
      }
      drawingTextContext = snippets.join("\n\n").slice(0, 10000);
    }

    const systemPrompt = `You are a rebar detailing expert. Generate bar schedule items from estimate line items.
Rules:
- Return ONLY a JSON array, no markdown, no explanation.
- Each object MUST include "estimate_item_index": the [INDEX=N] number of the source estimate item.
- Each object: { "mark": string, "size": string, "shape_code": string, "cut_length": number (mm), "quantity": number, "finish_type": string, "cover_value": number (mm), "lap_length": number (mm), "confidence": number (0-1) }
- **BAR MARKS (CRITICAL)**: If drawing text is provided with ACTUAL bar marks (e.g., B1001, BS03, BS31, B2001, BD01, BT01), use those EXACT marks instead of generic sequential marks (A1, A2, B1). Parse the bar list tables from the drawing text.
- If no drawing text is available, use sequential marks like "A1", "A2", "B1" etc.
- shape_code: "straight", "L-shape", "U-shape", "Z-shape", "hook", "stirrup", "closed" as appropriate. If drawing text provides shape dimensions (A, B, C, D, E columns), use them to determine shape_code and cut_length.
- finish_type: "black", "epoxy", "galvanized" — default "black".
- cover_value: typical 40-75mm based on exposure.
- lap_length: standard lap splice length for the bar size (e.g. 40db).
- cut_length in mm. Convert from meters if estimate gives meters. If drawing provides shape dimensions, compute cut_length from the sum of dimensions.
- confidence 0.7-0.95 for standard items. Higher confidence when using actual drawing data.
- Generate 1-3 bar items per estimate line item. Break complex items into individual bar marks.
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

${drawingTextContext ? `=== DRAWING TEXT (parse bar lists for ACTUAL marks, sizes, quantities, shape dimensions) ===\n${drawingTextContext}\n=== END DRAWING TEXT ===` : ""}

Generate bar schedule items for these estimate items. Use ACTUAL bar marks from drawings if available. For each bar, return the "estimate_item_index" matching the [INDEX=N] of the source estimate item.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      console.error("AI error:", status, await aiResponse.text());
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    let items: any[];
    try {
      const jsonStr = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      items = JSON.parse(jsonStr);
      if (!Array.isArray(items)) throw new Error("Not an array");
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      return new Response(JSON.stringify({ error: "AI returned invalid format. Please try again." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = items.map((item: any) => {
      const eiIndex = Number(item.estimate_item_index);
      const linkedEi = !isNaN(eiIndex) && eiIndex >= 0 && eiIndex < estimateItems.length
        ? estimateItems[eiIndex] : null;
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
        estimate_item_id: linkedEi?.id || null,
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

    await supabase.from("audit_events").insert({
      user_id: user.id,
      project_id,
      segment_id,
      action: "auto_bar_schedule",
      entity_type: "segment",
      entity_id: segment_id,
      metadata: { bars_created: inserted?.length || 0 },
    });

    return new Response(JSON.stringify({
      success: true,
      bars_created: inserted?.length || 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("auto-bar-schedule error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
