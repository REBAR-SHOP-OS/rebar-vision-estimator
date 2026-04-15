import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from JWT
    let userId: string | null = null;
    if (authHeader) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await anonClient.auth.getUser(token);
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      q = null,
      project_id = null,
      sheet_id = null,
      bar_mark = null,
      discipline = null,
      drawing_type = null,
      revision = null,
      crm_deal_id = null,
      drawing_set_id = null,
      sort = "relevance",
      limit = 50,
    } = body;

    const filters: Record<string, string> = {};
    if (project_id) filters.project_id = project_id;
    if (sheet_id) filters.sheet_id = sheet_id;
    if (bar_mark) filters.bar_mark = bar_mark;
    if (discipline) filters.discipline = discipline;
    if (drawing_type) filters.drawing_type = drawing_type;
    if (revision) filters.revision = revision;
    if (crm_deal_id) filters.crm_deal_id = crm_deal_id;
    if (drawing_set_id) filters.drawing_set_id = drawing_set_id;
    if (sort) filters.sort = sort;

    const { data, error } = await supabase.rpc("search_drawings", {
      p_user_id: userId,
      p_query: q || null,
      p_filters: filters,
      p_limit: Math.min(limit, 100),
    });

    if (error) {
      console.error("search_drawings RPC error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ results: data || [], count: (data || []).length }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("search-drawings error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
