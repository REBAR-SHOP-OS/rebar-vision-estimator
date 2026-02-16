import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { barList, elements, projectName, clientName, standard, coatingType, sizeBreakdown, options } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    // Merge options with defaults
    const opts = {
      scale: "1:50",
      includeDims: true,
      layerGrouping: true,
      barMarks: true,
      drawingPrefix: "SD-",
      notes: "",
      ...options,
    };

    const barSummary = (barList || []).slice(0, 200).map((b: any) =>
      `${b.bar_mark || "—"}|${b.size}|${b.shape_code || "straight"}|${b.qty}|${b.length_ft}ft|${b.element_id}`
    ).join("\n");

    const sizeSummary = Object.entries(sizeBreakdown || {})
      .map(([size, weight]) => `${size}: ${weight} lbs`)
      .join(", ");

    const uniqueShapes = [...new Set((barList || []).map((b: any) => b.shape_code).filter(Boolean))];

    const prompt = `You are a professional rebar detailer. Generate a complete HTML shop drawing document.

PROJECT INFO:
- Name: ${projectName || "Project"}
- Client: ${clientName || "—"}
- Date: ${dateStr}
- Standard: ${standard || "ACI 318 / RSIC"}
- Coating: ${coatingType || "Black Steel"}
- Drawing Number Prefix: ${opts.drawingPrefix}
- Scale: ${opts.scale}

DRAWING OPTIONS:
- Include Dimension Lines & Length Annotations: ${opts.includeDims ? "YES" : "NO"}
- Group Bars by Element Type (Layer Grouping): ${opts.layerGrouping ? "YES" : "NO"}
- Show Bar Mark Labels on Each Bar: ${opts.barMarks ? "YES" : "NO"}
${opts.notes ? `- Special Notes from User: ${opts.notes}` : ""}

BAR LIST DATA (bar_mark|size|shape_code|qty|length_ft|element_id):
${barSummary || "No bar list data"}

SIZE BREAKDOWN: ${sizeSummary || "N/A"}

UNIQUE SHAPE CODES: ${uniqueShapes.join(", ") || "straight only"}

Generate a COMPLETE standalone HTML document for a professional shop drawing with:
1. Project header (name, client, date, standard, drawing number with prefix "${opts.drawingPrefix}")
2. Scale indicator showing "${opts.scale}"
${opts.includeDims ? "3. Bar Bending Schedule table with columns: Bar Mark, Size, Shape Code, Qty, Cut Length, Total Weight, with dimension annotations" : "3. Bar Bending Schedule table with columns: Bar Mark, Size, Shape Code, Qty, Cut Length, Total Weight (NO dimension annotations)"}
${opts.layerGrouping ? "4. Group bars by element type with section headers for each group" : "4. List all bars in a single flat table without grouping"}
${opts.barMarks ? "5. Label each bar with its bar mark ID" : "5. Do NOT show bar mark labels"}
6. For each unique shape code, a section describing the bend geometry (dimensions A, B, C, D, E as applicable)
7. Size summary table
8. Notes section with applicable standards${opts.notes ? ` and user notes: "${opts.notes}"` : ""}
9. Footer with disclaimer and date

Use professional styling:
- Dark navy header (#1a1a2e)
- Clean table borders
- Print-optimized @page rules
- Professional engineering document look
- Page breaks between major sections

Return ONLY the complete HTML document, nothing else. No markdown, no explanation.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a professional rebar detailing engineer. Output only valid HTML documents." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI generation failed");
    }

    const data = await response.json();
    let html = data.choices?.[0]?.message?.content || "";

    // Strip markdown code fences if present
    html = html.replace(/^```html\s*/i, "").replace(/```\s*$/, "").trim();

    return new Response(JSON.stringify({ html }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-shop-drawing error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
