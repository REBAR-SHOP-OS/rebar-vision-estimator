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
    const { barList, elements, projectName, clientName, standard, coatingType, sizeBreakdown, options, logoDataUri } = await req.json();

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

    const prompt = `You are a professional rebar detailer at REBAR.SHOP. Generate a complete HTML shop drawing document that matches the exact professional standard of real construction shop drawings.

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

Generate a COMPLETE standalone HTML document for a professional shop drawing. The output MUST have a DRAWING FRAME (border around entire page) with a TITLE BLOCK in the bottom-right corner, exactly like real engineering shop drawings. 

CRITICAL LAYOUT REQUIREMENTS:

1. **DRAWING FRAME**: A thick black border around the entire page content area. Inside is the drawing area.

2. **TITLE BLOCK** (bottom-right, ~300px wide, full bottom height ~200px):
   - Company logo: include this exact HTML at the top of the title block: <img src="${logoDataUri || ""}" style="height:40px;margin-bottom:4px;" alt="REBAR.SHOP" />
   - Company name "REBAR.SHOP" with tagline "AN INNOVATIVE METHOD OF FABRICATION" in bold
   - Project address line
   - "PART OF DRAWING:" label with value (e.g. "CONCRETE SHEAR WALL" or element description)
   - "CUSTOMER:" field
   - "Project no." field
   - "SCALE:" field showing "${opts.scale}"
   - "DETAILED BY:" and "CHECKED BY:" fields
   - "DRAWING No." and "BAR LIST No." showing "${opts.drawingPrefix}XX"
   - "FOR FIELD USE" box with grade indicator "400/R"
   - Small bar size legend row: "B.M. 4M 5M 6M 10M 15M 20M 25M 30M 35M"

3. **REVISION TABLE** (above title block, right side):
   - Columns: ISSUE | REMARKS | DATE | BY
   - Triangle revision markers (△)
   - At least one row: "FOR APPROVAL | ${dateStr} | ${(clientName || "").substring(0,2).toUpperCase() || "MR"}"

4. **REFERENCE TABLES** (left of title block, bottom strip):
   - LAP SCHEDULE table: Size | TOP 25 MPA | OTHERS columns
   - LD SCHEDULE table: Size | values
   - COVER DETAILS table: Face type | clearance values

5. **MAIN DRAWING AREA** (above title block strip):
   - Bar Bending Schedule (BBS) tables organized by section (e.g. "Bars Below SD5", "Bars Below SD6")
   - BBS table columns: Bar Mark | Size | No | Qty | Total Length | Tail | Y | Y | Y | Y | Y | Y | Y | Y (dimension columns for bend dimensions A,B,C,D,E,F,G,H)
   - Header row "BM d7" style with column dimension labels
   - Each bar row: mark ID, size (e.g. 10M, 15M, 25M), quantity, total length, then bend dimensions in mm
   
6. **SHAPE KEY DIAGRAMS** (below BBS tables):
   - SVG shape diagrams for each unique bend type:
     - Shape 0: Straight bar with "Length" label
     - Shape T12: Hook one end
     - Shape T1: Hooks A & B optional, dimension markings
     - Shape 17: 90° bend
     - Shape 2: Hook B optional
     - Shape 31: Z-bend
   - Each shape shows dimension labels (A, B, C, D, E, Length)
   - Include text "Hook B optional" where applicable
   - Draw with thin black lines, dimension arrows, and labels

STYLING:
- White background, black lines and text
- Table borders: 1px solid black
- Font: Arial or sans-serif, 8-9px for table data, 10-11px for headers
- @page rules: landscape, letter size, margins 0.3in
- Title block has slightly thicker borders (2px)
- Print-optimized: no background colors except white
- Grid lines visible on all tables
- Professional engineering document look — clean, precise, no colors except black/white

Return ONLY the complete HTML document, nothing else. No markdown, no explanation.`;


    const aiStart = performance.now();
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a professional rebar detailing engineer. Output only valid HTML documents." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        top_p: 1,
        max_tokens: 16384,
      }),
    });

    const aiLatency = Math.round(performance.now() - aiStart);
    console.log(JSON.stringify({ route: "generate-shop-drawing", provider: "google/gemini", gateway: "lovable-ai", pinned_model: "google/gemini-2.5-flash", latency_ms: aiLatency, success: response.ok, fallback_used: false }));

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
