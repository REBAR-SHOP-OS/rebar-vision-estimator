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

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
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

    // No real scope detected — no fallback
    await supabase.from("audit_log").insert({
      user_id: userId,
      project_id,
      action: "scope_none",
      details: {
        source_type: "none",
        confidence: 0,
        reason: hasRealScope ? "no_drawings" : "no_scope_items",
      },
    });

    return new Response(JSON.stringify({
      source_type: "none",
      scope_items: [],
      project_type: null,
      confidence: 0,
      warning: "No scope detected. Upload drawings for scope extraction.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
