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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { segment_id, project_id } = await req.json();
    if (!segment_id || !project_id) {
      return new Response(JSON.stringify({ error: "segment_id and project_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gather context
    const [segRes, projRes, filesRes, stdRes, existingRes, searchIndexRes, knowledgeRes] = await Promise.all([
      supabase.from("segments").select("*").eq("id", segment_id).single(),
      supabase.from("projects").select("name, project_type, scope_items, description").eq("id", project_id).single(),
      supabase.from("project_files").select("id, file_name, file_type").eq("project_id", project_id).limit(20),
      supabase.from("standards_profiles").select("*").eq("user_id", user.id).eq("is_default", true).limit(1),
      supabase.from("estimate_items").select("description, bar_size").eq("segment_id", segment_id).limit(50),
      supabase.from("drawing_search_index").select("raw_text, page_number, extracted_entities").eq("project_id", project_id).limit(50),
      supabase.from("agent_knowledge").select("title, content").eq("user_id", user.id).limit(10),
    ]);

    const segment = segRes.data;
    const project = projRes.data;
    const files = filesRes.data || [];
    const standard = stdRes.data?.[0];
    const existing = existingRes.data || [];

    // Build drawing text from search index (OCR) first, fallback to doc versions
    let drawingTextContext = "";
    const searchPages = searchIndexRes.data || [];
    if (searchPages.length > 0) {
      const textSnippets: string[] = [];
      for (const page of searchPages) {
        const text = (page.raw_text || "").trim();
        if (text.length > 20) {
          textSnippets.push(`[Page ${page.page_number}] ${text.substring(0, 2000)}`);
        }
      }
      drawingTextContext = textSnippets.join("\n\n").slice(0, 12000);
    } else {
      try {
        const { data: docVersions } = await supabase
          .from("document_versions")
          .select("pdf_metadata, file_name")
          .eq("project_id", project_id)
          .limit(10);
        if (docVersions && docVersions.length > 0) {
          const textSnippets: string[] = [];
          for (const dv of docVersions) {
            const meta = dv.pdf_metadata as any;
            if (meta?.pages) {
              for (const page of meta.pages.slice(0, 5)) {
                if (page.raw_text) {
                  textSnippets.push(`[${dv.file_name} p${page.page_number}] ${page.raw_text.slice(0, 1500)}`);
                }
              }
            }
          }
          drawingTextContext = textSnippets.join("\n\n").slice(0, 8000);
        }
      } catch (drawErr) {
        console.warn("Could not fetch drawing text:", drawErr);
      }
    }

    // Build RSIC knowledge context
    let knowledgeContext = "";
    const knowledgeEntries = knowledgeRes.data || [];
    if (knowledgeEntries.length > 0) {
      const relevant = knowledgeEntries.filter((k: any) =>
        /RSIC|standard|rebar|mass|weight|bar.*size|estimat/i.test(k.title || "") ||
        /RSIC|standard|rebar|mass|weight|bar.*size|estimat/i.test((k.content || "").substring(0, 200))
      );
      if (relevant.length > 0) {
        knowledgeContext = "\n=== RSIC STANDARDS REFERENCE ===\n";
        for (const k of relevant.slice(0, 3)) {
          knowledgeContext += `[${k.title}]\n${(k.content || "").substring(0, 2000)}\n\n`;
        }
      }
    }

    // Detect scope coverage from file names AND OCR drawing tokens (5 construction buckets).
    // Buckets are universal across project types — never hard-code a single project's scope.
    const fileNames = files.map((f: any) => (f.file_name || "").toUpperCase());
    const ocrUpper = (drawingTextContext || "").toUpperCase();
    const corpus = `${fileNames.join(" ")} ${ocrUpper}`;
    const BUCKET_TOKENS: Record<string, RegExp> = {
      FOUNDATION: /FOOTING|FOUND|FTG|PILE|CAISSON|RAFT|MAT|PILE.?CAP|GRADE.?BEAM|FROST.?WALL/,
      VERTICAL:   /\bWALL\b|\bCOLUMN\b|\bCOL\b|PIER|SHEAR|RETAINING|CMU|ICF/,
      HORIZONTAL: /\bBEAM\b|GIRDER|JOIST|LINTEL|BOND.?BEAM/,
      SLAB:       /\bSLAB\b|\bSOG\b|SLAB.?ON.?GRADE|SUSPENDED|TOPPING|DECK/,
      MISC:       /STAIR|LEDGE|CURB|STOOP|EQUIPMENT.?PAD|ELEVATOR.?PIT|SUMP|TRANSFORMER/,
    };
    const bucketsPresent = Object.entries(BUCKET_TOKENS)
      .filter(([_, rx]) => rx.test(corpus)).map(([k]) => k);
    const bucketsAbsent = Object.keys(BUCKET_TOKENS).filter((k) => !bucketsPresent.includes(k));
    const scopeHint = project?.scope_items?.length
      ? project.scope_items.join(", ")
      : (bucketsPresent.length
          ? `BUCKETS PRESENT: ${bucketsPresent.join(", ")}. BUCKETS ABSENT (do NOT estimate): ${bucketsAbsent.join(", ") || "none"}`
          : "");

    if (!segment) {
      return new Response(JSON.stringify({ error: "Segment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingDesc = existing.map((e: any) => e.description).filter(Boolean).join(", ");

    const systemPrompt = `You are a rebar estimating expert. Output estimate line items ONLY from drawing evidence in the user message.
Rules:
- Return ONLY a JSON array of objects, no markdown, no explanation.
- Each object: { "description": string, "bar_size": string, "quantity_count": number, "total_length": number (meters for rebar, m² for wwm), "total_weight": number (kg), "confidence": number (0-1), "item_type": "rebar" | "wwm" }
- Bar sizes: use metric (10M, 15M, 20M, 25M, 30M, 35M) or imperial (#3, #4, #5, #6, #7, #8) based on standards.
- Confidence must reflect evidence strength from schedules/callouts — use low values when inferring.
- If the drawing text section is present, extract ONLY what is explicitly supported; do not invent quantities.
- If drawing text is absent or insufficient, return an empty JSON array [] — do NOT fabricate "typical practice" items.
- Weight must be consistent with bar size and length using standard rebar weights. Use these mass values (kg/m): 10M=0.785, 15M=1.570, 20M=2.355, 25M=3.925, 30M=5.495, 35M=7.850, #3=0.561, #4=0.994, #5=1.552, #6=2.235, #7=3.042, #8=3.973.
- MANDATORY COMPUTATION: For every line you MUST compute non-zero quantity_count, total_length (m) and total_weight (kg) from the OCR. Use these formulas when explicit bar list rows are not present:
  * Vertical wall bars: qty = ceil(wall_length_mm / spacing_mm) + 1; bar_length_m = (wall_height_mm + lap_mm) / 1000; total_length = qty * bar_length_m.
  * Horizontal wall bars: qty = ceil(wall_height_mm / spacing_mm) + 1; bar_length_m = (wall_length_mm + lap_mm) / 1000; total_length = qty * bar_length_m.
  * Footing/grade-beam continuous bars: qty = number_of_continuous_bars (from schedule, default 2 top + 2 bot if a section view shows it); total_length = qty * footing_length_m.
  * Slab bars EW: per direction qty = ceil(slab_dim_perp_mm / spacing_mm) + 1; total_length = qty * (slab_dim_parallel_m + lap_m).
  * Dowels: qty = ceil(perimeter_mm / spacing_mm); total_length = qty * (dowel_length_mm / 1000).
  * total_weight = total_length * mass_per_m for the bar size.
  Lap default = 40 * bar_dia_mm if lap not stated (10M=400, 15M=640, 20M=800, 25M=1000).
  Use spacing/lengths from the OCR (e.g. "@406 mm O.C.", "203mm wall", "457mm long"). Treat dimension callouts as authoritative.
- ZERO-VALUE RULE: A line with quantity_count=0 AND total_length=0 is FORBIDDEN unless the OCR truly has no geometry. Prefer computing from inferred geometry over emitting zeros. If you must emit a zero line, set confidence ≤ 0.2 and prefix description with "UNRESOLVED:".
- Output raw JSON numbers only — no thousands separators, no units inside number fields.
- WIRE MESH (WWM) DETECTION: If drawing text mentions "WWM", "welded wire mesh", "wire mesh", "W2.9", "W4.0", "MW9.1", mesh designations like "6x6-W2.9/W2.9" or "152x152 MW9.1/MW9.1", generate items with item_type "wwm" instead of "rebar".
  - For WWM items: bar_size = mesh designation (e.g. "6x6-W2.9"), total_length = area in m², quantity_count = number of sheets (standard sheet = 5'×10' = 4.65 m², add 150mm overlap).
  - WWM mass references (kg/m²): 6x6-W1.4/W1.4=0.93, 6x6-W2.1/W2.1=1.37, 6x6-W2.9/W2.9=1.90, 6x6-W4.0/W4.0=2.63, 4x4-W2.1/W2.1=2.05, 4x4-W4.0/W4.0=3.94.
  - Weight formula for WWM: total_weight = total_length (m²) × mass (kg/m²).
  - If a slab/SOG segment has BOTH rebar and mesh callouts, generate items for BOTH.
- CRITICAL: If drawing text is provided below, use the ACTUAL bar sizes, quantities, and lengths from the drawings — do NOT guess or inflate. Parse footing schedules, bar schedules, and rebar callouts directly.
- CRITICAL: Parse bar list tables from the drawing text. Each row typically has: Bar Mark, Qty, Size, Total Length, Type, and shape dimensions (A, B, C, D, E). Use these EXACT values for quantity_count and total_length.
- CRITICAL: Only estimate items that belong to THIS segment type. Do NOT add superstructure items to foundation segments or vice versa.
- CONCRETE = REBAR AXIOM (universal): every concrete element (footing, pier, pile cap, wall, column, beam, slab, SOG, suspended slab, stair, grade beam, frost wall, ledge, curb, equipment pad, retaining wall, mat, raft, stoop, …) MUST yield at least one rebar (or WWM) line. If the OCR mentions a concrete element with no rebar callout, emit ONE placeholder line with description "<element> — UNRESOLVED rebar (verify drawings)", quantity_count 0, total_length 0, total_weight 0, confidence 0.1, item_type "rebar".
- ${scopeHint ? `SCOPE RESTRICTION: ${scopeHint}` : ""}
- Do NOT duplicate items already estimated: ${existingDesc || "none yet"}.`;

    const userPrompt = `Project: ${project?.name || "Unknown"}
Type: ${project?.project_type || "Unknown"}
Scope: ${(project?.scope_items || []).join(", ") || "Not defined"}
Files: ${files.map((f: any) => f.file_name).join(", ") || "None"}

Segment: ${segment.name}
Type: ${segment.segment_type}
Level: ${segment.level_label || "Not specified"}
Zone: ${segment.zone_label || "Not specified"}
Notes: ${segment.notes || "None"}

Standards: ${standard ? `${standard.name} (${standard.code_family}, ${standard.units})` : "Default metric"}
Cover defaults: ${standard?.cover_defaults ? JSON.stringify(standard.cover_defaults) : "Standard"}
Lap defaults: ${standard?.lap_defaults ? JSON.stringify(standard.lap_defaults) : "Standard"}

${knowledgeContext}

${drawingTextContext ? `=== DRAWING TEXT (use this as primary source — parse bar lists, footing schedules, rebar callouts) ===\n${drawingTextContext}\n=== END DRAWING TEXT ===` : "No drawing text available — estimate based on typical construction practice for this element type. Be conservative."}

Generate estimate items for this segment. Base quantities on the ACTUAL drawing data if available, not assumptions.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        temperature: 0,
        max_tokens: 16000,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", status, errText);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";
    const finishReason = aiData.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      console.warn("[auto-estimate] AI response truncated (finish_reason=length)");
    }

    // Parse JSON from response (strip markdown fences if present)
    let items: any[];
    try {
      let jsonStr = rawContent.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      // Slice from first '[' to last ']' to drop any prose preamble/postamble
      const start = jsonStr.indexOf("[");
      const end = jsonStr.lastIndexOf("]");
      if (start !== -1 && end > start) jsonStr = jsonStr.slice(start, end + 1);
      // Strip trailing commas before ] or }
      jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
      items = JSON.parse(jsonStr);
      if (!Array.isArray(items)) throw new Error("Not an array");
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      return new Response(JSON.stringify({ error: "AI returned invalid format. Please try again." }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mass lookup (kg/m for rebar, kg/m² for WWM) — used to backfill missing weights
    const REBAR_MASS: Record<string, number> = {
      "10M": 0.785, "15M": 1.570, "20M": 2.355, "25M": 3.925, "30M": 5.495, "35M": 7.850,
      "#3": 0.561, "#4": 0.994, "#5": 1.552, "#6": 2.235, "#7": 3.042, "#8": 3.973,
    };
    const WWM_MASS: Record<string, number> = {
      "6X6-W1.4/W1.4": 0.93, "6X6-W2.1/W2.1": 1.37, "6X6-W2.9/W2.9": 1.90,
      "6X6-W4.0/W4.0": 2.63, "4X4-W2.1/W2.1": 2.05, "4X4-W4.0/W4.0": 3.94,
    };
    const massFor = (size: string, type: string): number => {
      const k = String(size || "").toUpperCase().trim();
      if (type === "wwm") return WWM_MASS[k] || 0;
      const m = k.match(/^(10M|15M|20M|25M|30M|35M|#[3-8])/);
      return m ? REBAR_MASS[m[1]] || 0 : 0;
    };
    // Backfill total_weight from total_length × mass when AI returned 0
    for (const it of items) {
      const len = Number(it.total_length) || 0;
      const wgt = Number(it.total_weight) || 0;
      if (wgt === 0 && len > 0) {
        const mass = massFor(String(it.bar_size || ""), String(it.item_type || "rebar"));
        if (mass > 0) it.total_weight = +(len * mass).toFixed(2);
      }
    }

    // Weight validation gate — flag outliers
    const totalAiWeight = items.reduce((s: number, i: any) => s + (Number(i.total_weight) || 0), 0);
    const segType = segment.segment_type;
    const weightLimits: Record<string, number> = {
      footing: 5000, pier: 3000, slab: 15000, wall: 8000, beam: 5000, column: 3000,
      stair: 2000, pit: 2000, curb: 1000, retaining_wall: 10000, miscellaneous: 10000,
    };
    const maxWeight = weightLimits[segType] || 15000;
    if (totalAiWeight > maxWeight) {
      console.warn(`[weight-gate] AI estimated ${totalAiWeight.toFixed(0)}kg for ${segType} segment "${segment.name}" — exceeds ${maxWeight}kg limit. Flagging low confidence.`);
      // Scale down confidence for all items to flag as suspicious
      items.forEach((item: any) => { item.confidence = Math.min(item.confidence || 0.5, 0.4); });
    }

    // Prefer first structural-tagged file from names; else first file (per-line provenance still weak until pipeline links rows)
    const upperNames = files.map((f: { file_name?: string }) => (f.file_name || "").toUpperCase());
    let sourceFileId: string | null = null;
    const structIdx = upperNames.findIndex((n: string) => /STRUCTURAL|^S[-_]|\bSTR\b|FTG|FOOT|FOUND/i.test(n));
    if (structIdx >= 0) sourceFileId = files[structIdx].id;
    else if (files.length > 0) sourceFileId = files[0].id;

    // Insert items into estimate_items
    const rows = items.map((item: any) => ({
      segment_id,
      project_id,
      user_id: user.id,
      description: String(item.description || "").slice(0, 500),
      bar_size: String(item.bar_size || "").slice(0, 20),
      quantity_count: Math.max(0, Math.round(Number(item.quantity_count) || 0)),
      total_length: Math.max(0, Number(item.total_length) || 0),
      total_weight: Math.max(0, Number(item.total_weight) || 0),
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
      item_type: String(item.item_type || "rebar"),
      status: "draft",
      source_file_id: sourceFileId || null,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from("estimate_items")
      .insert(rows)
      .select("id");

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to save items" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update segment confidence to avg of its estimate items
    const avgConf = rows.reduce((s, r) => s + (r.confidence as number), 0) / (rows.length || 1);
    await supabase.from("segments").update({ confidence: Math.round(avgConf * 100) / 100 }).eq("id", segment_id);

    // Audit log
    await supabase.from("audit_events").insert({
      user_id: user.id,
      project_id,
      segment_id,
      action: "auto_estimated",
      entity_type: "segment",
      entity_id: segment_id,
      metadata: { items_created: inserted?.length || 0 },
    });

    return new Response(JSON.stringify({
      success: true,
      items_created: inserted?.length || 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auto-estimate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
