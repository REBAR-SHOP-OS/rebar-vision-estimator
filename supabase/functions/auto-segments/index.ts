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

    // Fetch project scope_items, project_type, and file names
    const [projRes, filesRes, existingSegs] = await Promise.all([
      supabase.from("projects").select("scope_items, project_type, name, client_name").eq("id", projectId).single(),
      supabase.from("project_files").select("file_name").eq("project_id", projectId),
      supabase.from("segments").select("name, segment_type").eq("project_id", projectId),
    ]);

    const project = projRes.data;
    if (!project) throw new Error("Project not found");

    const scopeItems: string[] = project.scope_items || [];
    const fileNames = (filesRes.data || []).map((f: any) => f.file_name);
    const existingSegNames = new Set((existingSegs.data || []).map((s: any) => s.name.toLowerCase()));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `You are a rebar estimation expert. Given the following project information, generate a list of structural segments that should be created for estimation.

Project: ${project.name}
Client: ${project.client_name || "N/A"}
Project Type: ${project.project_type || "unknown"}
Scope Items: ${scopeItems.length > 0 ? scopeItems.join(", ") : "None detected yet"}
Uploaded Files: ${fileNames.length > 0 ? fileNames.join(", ") : "None"}
Existing Segments (DO NOT duplicate these): ${existingSegs.data?.map((s: any) => s.name).join(", ") || "None"}

Rules:
- Generate realistic, specific segments based on the scope items and project type
- Each segment should represent a distinct structural element or zone
- Use industry-standard naming (e.g., "Footings F1-F4", "Ground Floor Slab", "Columns Level 1", "Stair ST-1")
- Include level/zone labels where appropriate
- Map each to a segment_type from this list: footing, slab, wall, beam, column, pier, stair, pit, curb, retaining_wall, miscellaneous
- If scope_items is empty, infer reasonable defaults from the project type and file names
- Do NOT suggest segments that already exist (case-insensitive match)
- Generate 3-15 segments depending on project complexity

Return ONLY a JSON array of objects with these fields:
- name (string): descriptive segment name
- segment_type (string): one of the allowed types
- level_label (string|null): e.g. "L1", "B1", "Ground"
- zone_label (string|null): e.g. "Zone A", "Grid 1-5"
- notes (string|null): brief context for why this segment was suggested

Example:
[{"name":"Strip Footings F1-F6","segment_type":"footing","level_label":"B1","zone_label":null,"notes":"Based on FOOTING scope item"},{"name":"Ground Floor SOG","segment_type":"slab","level_label":"Ground","zone_label":null,"notes":"Based on SLAB_ON_GRADE scope item"}]`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a structural engineering assistant. Return ONLY valid JSON arrays, no markdown fences." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI gateway error: ${aiRes.status} ${errText}`);
    }

    const aiData = await aiRes.json();
    let raw = aiData.choices?.[0]?.message?.content || "[]";
    
    // Strip markdown fences if present
    raw = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

    let suggestions: any[];
    try {
      suggestions = JSON.parse(raw);
    } catch {
      console.error("Failed to parse AI response:", raw);
      suggestions = [];
    }

    // Filter out duplicates of existing segments
    const allowedTypes = new Set(["footing", "slab", "wall", "beam", "column", "pier", "stair", "pit", "curb", "retaining_wall", "miscellaneous"]);
    const filtered = suggestions
      .filter((s: any) => s.name && !existingSegNames.has(s.name.toLowerCase()))
      .map((s: any) => ({
        name: String(s.name).substring(0, 100),
        segment_type: allowedTypes.has(s.segment_type) ? s.segment_type : "miscellaneous",
        level_label: s.level_label || null,
        zone_label: s.zone_label || null,
        notes: s.notes ? String(s.notes).substring(0, 200) : null,
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
