import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Per-project-type playbooks. Each entry seeds the segment finder with the
 * scope it should EXPECT, the scope it should NEVER suggest, and bar-mark
 * prefix conventions specific to that family of projects. The AI prompt is
 * built dynamically from the matching playbook so a residential project no
 * longer gets generic "SOG / Footings / Walls" hallucinations and a cage_only
 * project no longer gets slabs and elevated decks.
 */
type Playbook = {
  expected_buckets: string[];
  must_have: Array<{ name: string; segment_type: string; bucket: string; notes: string }>;
  forbidden_types: string[];
  bar_mark_hints: string;
  prompt_emphasis: string;
};
const PLAYBOOKS: Record<string, Playbook> = {
  residential: {
    expected_buckets: ["Substructure", "Slab-on-Grade", "Masonry"],
    must_have: [
      { name: "Strip Footings", segment_type: "footing", bucket: "Substructure", notes: "Residential default" },
      { name: "Basement / Foundation Walls", segment_type: "wall", bucket: "Substructure", notes: "Residential default" },
      { name: "Slab-on-Grade", segment_type: "slab", bucket: "Slab-on-Grade", notes: "Residential default" },
      { name: "Garage Slab", segment_type: "slab", bucket: "Slab-on-Grade", notes: "Residential default" },
    ],
    forbidden_types: ["crane beam", "post-tension deck", "abutment", "pier cap", "caisson cage"],
    bar_mark_hints: "Common: F# = footings, W# = walls, SOG = slab. ICF walls common. No PT decks.",
    prompt_emphasis: "Focus on strip/pad footings, basement & ICF walls, SOG, garage slabs, deck piles. Skip multi-storey columns, PT decks, crane beams.",
  },
  commercial: {
    expected_buckets: ["Substructure", "Slab-on-Grade", "Superstructure"],
    must_have: [
      { name: "Pile Caps / Pad Footings", segment_type: "footing", bucket: "Substructure", notes: "Commercial default" },
      { name: "Columns (per level)", segment_type: "column", bucket: "Superstructure", notes: "Commercial default" },
      { name: "Elevated Slabs (per level)", segment_type: "slab", bucket: "Superstructure", notes: "Commercial default" },
      { name: "Shear Walls", segment_type: "wall", bucket: "Superstructure", notes: "Commercial default" },
    ],
    forbidden_types: ["icf wall", "garage slab"],
    bar_mark_hints: "Common: COL/C# = columns, B# = beams, SW# = shear walls, FC# = footing caps. Group by level (L1, L2…).",
    prompt_emphasis: "Emphasize columns by level, elevated slabs, shear walls, drop panels, post-tension decks if found. Group footings by mark from a footing schedule.",
  },
  industrial: {
    expected_buckets: ["Substructure", "Slab-on-Grade", "Superstructure"],
    must_have: [
      { name: "Equipment Pads", segment_type: "miscellaneous", bucket: "Slab-on-Grade", notes: "Industrial default" },
      { name: "Tank Bases / Ringwalls", segment_type: "footing", bucket: "Substructure", notes: "Industrial default" },
      { name: "Crane Beams", segment_type: "beam", bucket: "Superstructure", notes: "Industrial default" },
      { name: "Heavy Process Slab", segment_type: "slab", bucket: "Slab-on-Grade", notes: "Industrial default" },
    ],
    forbidden_types: ["icf wall", "basement wall", "garage slab"],
    bar_mark_hints: "Common: EP# = equipment pads, T# = tank bases, CB# = crane beams. Bars often 25M / 30M / 35M.",
    prompt_emphasis: "Emphasize equipment pads, tank bases, secondary containment, crane beams, heavy-load slabs. Bars are typically larger (25M+).",
  },
  infrastructure: {
    expected_buckets: ["Substructure", "Superstructure", "Site"],
    must_have: [
      { name: "Abutments", segment_type: "wall", bucket: "Substructure", notes: "Infra default" },
      { name: "Pier Caps", segment_type: "pier", bucket: "Superstructure", notes: "Infra default" },
      { name: "Deck Panels", segment_type: "slab", bucket: "Superstructure", notes: "Infra default" },
      { name: "Barriers", segment_type: "miscellaneous", bucket: "Site", notes: "Infra default" },
    ],
    forbidden_types: ["icf wall", "basement wall", "garage slab", "elevated slab"],
    bar_mark_hints: "MTO/OPSS callouts. Common: AB# = abutment, PC# = pier cap, DP# = deck panel, BAR# = barrier. Bars: 15M/20M/25M epoxy.",
    prompt_emphasis: "Emphasize abutments, pier caps, deck panels, traffic barriers, culverts. Watch for MTO/OPSS spec callouts and epoxy coating.",
  },
  cage_only: {
    expected_buckets: ["Substructure"],
    must_have: [
      { name: "Caisson Cage Group", segment_type: "pier", bucket: "Substructure", notes: "Cage-only default" },
    ],
    forbidden_types: ["slab", "wall", "beam", "footing", "elevated slab", "stair", "pit", "curb"],
    bar_mark_hints: "Cage marks (CG#, C#) grouped by diameter and length. Spirals often #4 @ 6\" pitch.",
    prompt_emphasis: "ONLY produce cage-assembly segments grouped by cage diameter and length. Suppress everything else (no slabs, walls, beams, SOGs).",
  },
  bar_list_only: {
    expected_buckets: [],
    must_have: [],
    forbidden_types: [],
    bar_mark_hints: "Bar marks ARE the segments. One segment per bar-mark family from the schedule.",
    prompt_emphasis: "Group bar marks from the schedule into ONE segment per family (by mark prefix). Do NOT invent structural elements.",
  },
};
function getPlaybook(projectType: string | null | undefined): Playbook {
  return PLAYBOOKS[(projectType || "").toLowerCase()] || PLAYBOOKS.commercial;
}

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

    // Fetch project data, files, existing segments, OCR text, doc versions, RSIC knowledge,
    // user's saved scope templates, and the latest project-classification audit event.
    const [projRes, filesRes, existingSegs, searchIndexRes, docVersionsRes, knowledgeRes, templatesRes, classifyEvtRes] = await Promise.all([
      supabase.from("projects").select("scope_items, project_type, name, client_name").eq("id", projectId).single(),
      supabase.from("project_files").select("file_name").eq("project_id", projectId),
      supabase.from("segments").select("name, segment_type").eq("project_id", projectId),
      supabase.from("drawing_search_index").select("raw_text, page_number, extracted_entities").eq("project_id", projectId).limit(50),
      supabase.from("document_versions").select("file_name, pdf_metadata, page_count").eq("project_id", projectId).limit(20),
      supabase.from("agent_knowledge").select("title, content").eq("user_id", user.id).limit(10),
      supabase.from("scope_templates").select("name, scope_items, project_type, is_system").or(`is_system.eq.true,user_id.eq.${user.id}`),
      supabase.from("audit_events").select("metadata, created_at").eq("project_id", projectId).eq("action", "project_classified").order("created_at", { ascending: false }).limit(1),
    ]);

    const project = projRes.data;
    if (!project) throw new Error("Project not found");

    const scopeItems: string[] = project.scope_items || [];
    const fileNames = (filesRes.data || []).map((f: any) => f.file_name);
    const existingSegNames = new Set((existingSegs.data || []).map((s: any) => s.name.toLowerCase()));
    const playbook = getPlaybook(project.project_type);

    // Pull seeds from prior project classification (detect-project-type writes
    // recommendedScope/disciplinesFound/hiddenScope into audit_events.metadata).
    const classifyMeta = (classifyEvtRes.data?.[0]?.metadata as Record<string, unknown> | undefined) || {};
    const recommendedScope: string[] = Array.isArray((classifyMeta as any).recommendedScope) ? (classifyMeta as any).recommendedScope : [];
    const hiddenScopeFromClassify: string[] = Array.isArray((classifyMeta as any).hiddenScope) ? (classifyMeta as any).hiddenScope : [];

    // Pull user / system scope templates that match this project type.
    const matchedTemplates = (templatesRes.data || []).filter((t: any) =>
      !t.project_type || (t.project_type || "").toLowerCase() === (project.project_type || "").toLowerCase()
    );
    const templateSeeds: Array<{ name: string; segment_type: string; source: string }> = [];
    for (const t of matchedTemplates) {
      for (const item of (t.scope_items || []) as string[]) {
        templateSeeds.push({
          name: String(item),
          segment_type: "miscellaneous",
          source: t.is_system ? "system_template" : "user_template",
        });
      }
    }

    const classifyDiscipline = (name: string): string => {
      const n = name.toUpperCase();
      if (/\bS[-_ ]?\d|STRUC|STRUCTURAL/i.test(n)) return "structural";
      if (/\bA[-_ ]?\d|ARCH|ARCHITECTURAL/i.test(n)) return "architectural";
      if (/\bM[-_ ]?\d|MECH/i.test(n)) return "mechanical";
      if (/\bE[-_ ]?\d|ELEC/i.test(n)) return "electrical";
      return "general";
    };

    // Build drawing text from search index (OCR) — preferred source.
    // Split rebar-relevant pages from non-structural pages so the prompt can
    // mine the latter for "Hidden Scope" without polluting primary segments.
    const drawingTextByDiscipline: Record<string, string[]> = {};
    const hiddenScopeText: string[] = [];
    const searchPages = searchIndexRes.data || [];
    const docVersions = docVersionsRes.data || [];

    if (searchPages.length > 0) {
      for (const page of searchPages) {
        const text = (page.raw_text || "").trim();
        if (!text || text.length < 20) continue;
        const ent = (page.extracted_entities as any) || {};
        const tb = ent.title_block || {};
        const disc = tb.discipline?.toLowerCase() || "general";
        const sheetId = tb.sheet_number || `p${page.page_number}`;
        // sheet_category / rebar_relevant come from the populate-search-index
        // tagging patch (#5). When false, route the text to the hidden-scope
        // bucket so we surface CMU walls / depressed slabs / pole bases only.
        const rebarRelevant = ent.rebar_relevant !== false; // default true if missing
        if (!rebarRelevant) {
          hiddenScopeText.push(`[${sheetId}] ${text.substring(0, 1200)}`);
          continue;
        }
        if (!drawingTextByDiscipline[disc]) drawingTextByDiscipline[disc] = [];
        drawingTextByDiscipline[disc].push(`[${sheetId}] ${text.substring(0, 2000)}`);
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

    // Hidden-scope context (from non-structural sheets) — fed to the prompt
    // separately so the AI labels findings here as source="hidden_scope".
    let hiddenScopeContext = "";
    if (hiddenScopeText.length > 0) {
      hiddenScopeContext = "\n=== NON-STRUCTURAL SHEETS (mine for HIDDEN SCOPE only) ===\n";
      let cc = 0;
      for (const t of hiddenScopeText) {
        if (cc + t.length > 3000) break;
        hiddenScopeContext += t + "\n";
        cc += t.length;
      }
    }
    if (hiddenScopeFromClassify.length > 0) {
      hiddenScopeContext += `\nClassifier-flagged hidden scope: ${hiddenScopeFromClassify.join(", ")}\n`;
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

    // ---- Build the project-type-specific prompt ----
    const playbookSection = `
## PLAYBOOK (project_type=${project.project_type || "unknown"})
Expected construction buckets: ${playbook.expected_buckets.join(", ") || "(any)"}
Must-have defaults if drawings are thin:
${playbook.must_have.map((m) => `  - ${m.name} [${m.segment_type}] (${m.bucket})`).join("\n") || "  (none)"}
Forbidden segment types for this project type: ${playbook.forbidden_types.join(", ") || "(none)"}
Bar-mark conventions: ${playbook.bar_mark_hints}
Emphasis: ${playbook.prompt_emphasis}`;

    const seedsSection = `
## SEEDS (use as candidates if you find evidence — never invent unrelated ones)
Recommended scope from project classifier: ${recommendedScope.join(", ") || "(none)"}
Saved templates for this project type:
${templateSeeds.length > 0 ? templateSeeds.map((s) => `  - ${s.name} (${s.source})`).join("\n") : "  (none)"}`;

    const prompt = `You are a rebar estimation expert. Generate a list of structural segments for this project, **strictly following the project-type playbook below**. Do NOT produce generic SOG/Footings/Walls if the playbook forbids them.

Project: ${project.name}
Client: ${project.client_name || "N/A"}
Project Type: ${project.project_type || "unknown"}
Scope Items: ${scopeItems.length > 0 ? scopeItems.join(", ") : "None detected yet"}

Files by Discipline:
${fileDisciplineSummary || "No files uploaded"}

Existing Segments (DO NOT duplicate, case-insensitive): ${existingSegs.data?.map((s: any) => s.name).join(", ") || "None"}
${playbookSection}
${seedsSection}

${drawingContext}
${hiddenScopeContext}
${knowledgeContext}

Rules:
- **HIERARCHY**: (1) Drawing-confirmed evidence > (2) Playbook must-haves > (3) User templates > (4) Inferred.
- **NEVER** suggest a segment whose type matches the playbook's forbidden_types list.
- **HIDDEN SCOPE**: Items appearing ONLY in the "NON-STRUCTURAL SHEETS" block must be returned with source="hidden_scope" and a note pointing to the sheet_id.
- **BAR LIST PARSING**: If a bar schedule is present, group bar marks by family (prefix) into segments matching the playbook's bar_mark_hints.
- **FOOTING SCHEDULE** (F1..Fn): one segment per footing type OR group by size if many.
- **WALL ELEVATIONS** (W1..Wn): one segment per wall family.
- **CAGE_ONLY override**: produce ONLY cage-assembly segments grouped by diameter+length.
- **BAR_LIST_ONLY override**: ONE segment per bar-mark family from the schedule. Do NOT invent structural elements.
- Each segment must include source ∈ {"drawing","playbook","user_template","hidden_scope"} and bucket ∈ {"Substructure","Slab-on-Grade","Superstructure","Masonry","Site"}.
- Confidence: drawing=0.9, user_template=0.75, playbook=0.6, hidden_scope=0.55.
- Use industry-standard naming with ACTUAL element IDs when found in drawings.
- Generate 3–15 segments. Don't pad with low-relevance items just to hit a count.
- segment_type ∈ {footing, slab, wall, beam, column, pier, stair, pit, curb, retaining_wall, miscellaneous}.

Return ONLY a JSON array of objects with fields:
- name (string)
- segment_type (string)
- level_label (string|null)
- zone_label (string|null)
- notes (string|null)  — include source sheet IDs / bar marks / "playbook default" etc.
- source (string)      — drawing|playbook|user_template|hidden_scope
- bucket (string)      — one of the 5 construction buckets
- confidence (number)  — 0..1`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a structural engineering assistant. Strictly obey the per-project-type playbook in the user prompt. Return ONLY a valid JSON array, no markdown fences. Never produce a segment whose segment_type matches the playbook's forbidden_types." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
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

    // Always merge in playbook must-haves that the AI failed to produce, so a
    // residential project can't end up with zero candidates due to thin OCR.
    const aiNamesLower = new Set(suggestions.map((s: any) => String(s?.name || "").toLowerCase()));
    for (const mh of playbook.must_have) {
      if (!aiNamesLower.has(mh.name.toLowerCase()) && !existingSegNames.has(mh.name.toLowerCase())) {
        suggestions.push({
          name: mh.name,
          segment_type: mh.segment_type,
          level_label: null,
          zone_label: null,
          notes: mh.notes,
          source: "playbook",
          bucket: mh.bucket,
          confidence: 0.6,
        });
      }
    }

    const allowedTypes = new Set(["footing", "slab", "wall", "beam", "column", "pier", "stair", "pit", "curb", "retaining_wall", "miscellaneous"]);
    const allowedSources = new Set(["drawing", "playbook", "user_template", "hidden_scope"]);
    const allowedBuckets = new Set(["Substructure", "Slab-on-Grade", "Superstructure", "Masonry", "Site"]);
    const forbiddenTypeSet = new Set(playbook.forbidden_types.map((t) => t.toLowerCase()));
    const filtered = suggestions
      .filter((s: any) => s?.name && !existingSegNames.has(String(s.name).toLowerCase()))
      .filter((s: any) => {
        // Forbidden-type / forbidden-name guard.
        const t = String(s.segment_type || "").toLowerCase();
        const n = String(s.name || "").toLowerCase();
        if (forbiddenTypeSet.has(t)) return false;
        for (const f of forbiddenTypeSet) if (n.includes(f)) return false;
        return true;
      })
      .map((s: any) => ({
        name: String(s.name).substring(0, 100),
        segment_type: allowedTypes.has(s.segment_type) ? s.segment_type : "miscellaneous",
        level_label: s.level_label || null,
        zone_label: s.zone_label || null,
        notes: s.notes ? String(s.notes).substring(0, 300) : null,
        source: allowedSources.has(s.source) ? s.source : "playbook",
        bucket: allowedBuckets.has(s.bucket) ? s.bucket : null,
        confidence: typeof s.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : 0.6,
      }));

    return new Response(JSON.stringify({
      suggestions: filtered,
      playbook_used: project.project_type || "commercial",
      seeds: { recommended_scope: recommendedScope, templates: templateSeeds.length, hidden_scope_pages: hiddenScopeText.length },
    }), {
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
