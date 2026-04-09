import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const { projectId } = await req.json();
    if (!projectId) throw new Error("projectId is required");

    // Fetch project data, files, existing segments, OCR text, doc versions, and RSIC knowledge
    const [projRes, filesRes, existingSegs, searchIndexRes, docVersionsRes, knowledgeRes] = await Promise.all([
      supabase.from("projects").select("scope_items, project_type, name, client_name").eq("id", projectId).single(),
      supabase.from("project_files").select("file_name").eq("project_id", projectId),
      supabase.from("segments").select("name, segment_type").eq("project_id", projectId),
      supabase.from("drawing_search_index").select("raw_text, page_number, extracted_entities").eq("project_id", projectId).limit(50),
      supabase.from("document_versions").select("file_name, pdf_metadata, page_count").eq("project_id", projectId).limit(20),
      supabase.from("agent_knowledge").select("title, content").eq("user_id", user.id).limit(10),
    ]);

    const project = projRes.data;
    if (!project) throw new Error("Project not found");

    const scopeItems: string[] = project.scope_items || [];
    const fileNames = (filesRes.data || []).map((f: any) => f.file_name);
    const existingSegNames = new Set((existingSegs.data || []).map((s: any) => s.name.toLowerCase()));

    const classifyDiscipline = (name: string): string => {
      const n = name.toUpperCase();
      if (/\bS[-_ ]?\d|STRUC|STRUCTURAL/i.test(n)) return "structural";
      if (/\bA[-_ ]?\d|ARCH|ARCHITECTURAL/i.test(n)) return "architectural";
      if (/\bM[-_ ]?\d|MECH/i.test(n)) return "mechanical";
      if (/\bE[-_ ]?\d|ELEC/i.test(n)) return "electrical";
      return "general";
    };

    // Build drawing text from search index (OCR) — preferred source
    const drawingTextByDiscipline: Record<string, string[]> = {};
    const searchPages = searchIndexRes.data || [];
    const docVersions = docVersionsRes.data || [];

    if (searchPages.length > 0) {
      for (const page of searchPages) {
        const text = (page.raw_text || "").trim();
        if (!text || text.length < 20) continue;
        const tb = (page.extracted_entities as any)?.title_block || {};
        const disc = tb.discipline?.toLowerCase() || "general";
        if (!drawingTextByDiscipline[disc]) drawingTextByDiscipline[disc] = [];
        drawingTextByDiscipline[disc].push(`[Page ${page.page_number}] ${text.substring(0, 2000)}`);
      }
    } else if (docVersions.length > 0) {
      for (const dv of docVersions) {
        const disc = classifyDiscipline(dv.file_name || "");
        const meta = dv.pdf_metadata as any;
        if (!meta?.pages) continue;
        if (!drawingTextByDiscipline[disc]) drawingTextByDiscipline[disc] = [];
        for (const pg of (meta.pages || []).slice(0, 10)) {
          const text = (pg.raw_text || pg.text || "").trim();
          if (text.length > 20) {
            drawingTextByDiscipline[disc].push(`[${dv.file_name} p${pg.page_number || "?"}] ${text.substring(0, 2000)}`);
          }
        }
      }
    }

    // File discipline summary
    const filesByDiscipline: Record<string, string[]> = {};
    for (const fn of fileNames) {
      const disc = classifyDiscipline(fn);
      if (!filesByDiscipline[disc]) filesByDiscipline[disc] = [];
      filesByDiscipline[disc].push(fn);
    }

    // Build drawing context string
    let drawingContext = "";
    const hasDrawingText = Object.keys(drawingTextByDiscipline).length > 0;
    if (hasDrawingText) {
      for (const [disc, texts] of Object.entries(drawingTextByDiscipline)) {
        drawingContext += `\n=== ${disc.toUpperCase()} DRAWING TEXT ===\n`;
        let charCount = 0;
        for (const t of texts) {
          if (charCount + t.length > 5000) break;
          drawingContext += t + "\n";
          charCount += t.length;
        }
      }
    } else {
      drawingContext = "\n[No extracted drawing text available — segments will be inferred from file names and project type only]\n";
    }

    let fileDisciplineSummary = "";
    for (const [disc, fns] of Object.entries(filesByDiscipline)) {
      fileDisciplineSummary += `${disc}: ${fns.join(", ")}\n`;
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `You are a rebar estimation expert. Given the following project information, EXTRACTED DRAWING TEXT, and RSIC standards, generate a list of structural segments that should be created for estimation.

Project: ${project.name}
Client: ${project.client_name || "N/A"}
Project Type: ${project.project_type || "unknown"}
Scope Items: ${scopeItems.length > 0 ? scopeItems.join(", ") : "None detected yet"}

Files by Discipline:
${fileDisciplineSummary || "No files uploaded"}

Existing Segments (DO NOT duplicate these): ${existingSegs.data?.map((s: any) => s.name).join(", ") || "None"}

${drawingContext}
${knowledgeContext}

Rules:
- **BAR LIST PARSING (CRITICAL)**: If the drawing text contains bar lists or bar schedules, extract the ACTUAL element names from bar marks:
  - Bar marks like B1001, B1002 = SOG/slab bars
  - Bar marks like BS03, BS04 = Footing bars (F-1, F-2, etc.)
  - Bar marks like B2001, B2002 = Wall corner/continuous bars
  - Bar marks like BD01, BD02 = Dowel bars
  - Bar marks like BT01 = Tie bars
  - Map each bar mark prefix to its structural element
- **FOOTING SCHEDULES**: If a footing schedule is found (F1, F2, ..., F8), create ONE segment per footing type OR group by size
- **WALL ELEVATIONS**: If wall elevations are found (W1, W2, ..., W6), create segments per wall or group related walls
- **SOG/SLAB**: If SOG or slab-on-grade is mentioned with mesh (WWM) callouts, create a dedicated SOG segment
- **PIER/GRADE BEAM**: If pier or grade beam details are found, create dedicated segments
- Analyze ALL uploaded drawings — both structural AND architectural
- Cross-reference: structural drawings show rebar details; architectural drawings show dimensions, layouts, and concrete elements
- Flag "Hidden Scope" items found ONLY on architectural sheets
- Generate realistic, specific segments based on ACTUAL drawing content when available
- Each segment should represent a distinct structural element or zone
- Use industry-standard naming (e.g., "SOG Slab-on-Grade", "Isolated Footings F1-F8", "Wall W1", "Pier P1-P4")
- Include level/zone labels where appropriate
- Map each to a segment_type from: footing, slab, wall, beam, column, pier, stair, pit, curb, retaining_wall, miscellaneous
- If no drawing text is available, infer from file names and project type
- Do NOT suggest segments that already exist (case-insensitive match)
- Generate 3-15 segments depending on project complexity
- In the notes field, indicate which drawing(s)/bar marks each segment was found on

Return ONLY a JSON array of objects with these fields:
- name (string): descriptive segment name using ACTUAL element IDs from drawings
- segment_type (string): one of the allowed types
- level_label (string|null): e.g. "L1", "B1", "Ground"
- zone_label (string|null): e.g. "Zone A", "Grid 1-5"
- notes (string|null): brief context including source drawing references and bar marks found`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a structural engineering assistant. Analyze ALL provided drawing text from EVERY discipline (structural, architectural, etc.) to identify concrete/rebar segments. Parse bar lists and footing schedules to extract REAL element names. Return ONLY valid JSON arrays, no markdown fences." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI gateway error: ${aiRes.status} ${errText}`);
    }

    const aiData = await aiRes.json();
    let raw = aiData.choices?.[0]?.message?.content || "[]";
    raw = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

    let suggestions: any[];
    try {
      suggestions = JSON.parse(raw);
    } catch {
      console.error("Failed to parse AI response:", raw);
      suggestions = [];
    }

    const allowedTypes = new Set(["footing", "slab", "wall", "beam", "column", "pier", "stair", "pit", "curb", "retaining_wall", "miscellaneous"]);
    const filtered = suggestions
      .filter((s: any) => s.name && !existingSegNames.has(s.name.toLowerCase()))
      .map((s: any) => ({
        name: String(s.name).substring(0, 100),
        segment_type: allowedTypes.has(s.segment_type) ? s.segment_type : "miscellaneous",
        level_label: s.level_label || null,
        zone_label: s.zone_label || null,
        notes: s.notes ? String(s.notes).substring(0, 300) : null,
      }));

    return new Response(JSON.stringify({ suggestions: filtered }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auto-segments error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
