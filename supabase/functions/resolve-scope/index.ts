import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claims.claims.sub as string;

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), { status: 400, headers: corsHeaders });
    }

    // Load project
    const { data: project } = await supabase
      .from("projects")
      .select("scope_items, project_type, name")
      .eq("id", project_id)
      .single();

    // Count drawings
    const { count: drawingCount } = await supabase
      .from("drawing_search_index")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id);

    const hasRealScope = project?.scope_items && Array.isArray(project.scope_items) && project.scope_items.length > 0;
    const hasDrawings = (drawingCount || 0) > 0;

    if (hasRealScope && hasDrawings) {
      // Real project scope
      await supabase.from("audit_log").insert({
        user_id: userId,
        project_id,
        action: "scope_resolved",
        details: { source_type: "real_project", confidence: 0.9 },
      });

      return new Response(JSON.stringify({
        source_type: "real_project",
        scope_items: project.scope_items,
        project_type: project.project_type,
        confidence: 0.9,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fallback to 20 York template
    const { data: template } = await supabase
      .from("scope_templates")
      .select("scope_items, project_type, name, slug")
      .eq("slug", "20_york")
      .single();

    const fallbackScope = template?.scope_items || [
      "FOOTING", "GRADE_BEAM", "RAFT_SLAB", "PIER", "BEAM", "COLUMN",
      "SLAB", "STAIR", "WALL", "RETAINING_WALL", "ICF_WALL", "CMU_WALL",
      "WIRE_MESH", "CAGE",
    ];

    await supabase.from("audit_log").insert({
      user_id: userId,
      project_id,
      action: "scope_fallback_used",
      details: {
        source_type: "fallback_20_york",
        confidence: 0.3,
        reason: hasRealScope ? "no_drawings" : "no_scope_items",
        template_slug: "20_york",
      },
    });

    return new Response(JSON.stringify({
      source_type: "fallback_20_york",
      scope_items: fallbackScope,
      project_type: template?.project_type || "commercial",
      confidence: 0.3,
      warning: "Using fallback scope (20 York). Upload drawings for accurate scope detection.",
      template_name: template?.name || "20 York - Standard Commercial",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
