import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get user
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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      project_id,
      pages, // array of { page_number, raw_text, title_block, tables }
      document_version_id,
      crm_deal_id,
    } = body;

    if (!project_id || !pages || !Array.isArray(pages)) {
      return new Response(JSON.stringify({ error: "project_id and pages[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let indexed = 0;

    for (const page of pages) {
      const tb = page.title_block || {};
      const rawText = page.raw_text || "";
      if (!rawText.trim()) continue;

      // Extract bar marks from text using regex
      const barMarkPattern = /\b([A-Z]{1,2}\d{1,3})\b/g;
      const barMarks: string[] = [];
      let match;
      while ((match = barMarkPattern.exec(rawText)) !== null) {
        const bm = match[1];
        // Filter out common false positives
        if (!["OF", "IN", "AT", "TO", "AS", "IS", "IT", "OR", "ON", "IF", "NO", "DO", "UP"].includes(bm)) {
          if (!barMarks.includes(bm)) barMarks.push(bm);
        }
      }

      // Upsert logical drawing
      const sheetId = tb.sheet_number || null;
      const discipline = tb.discipline || null;
      const drawingType = tb.drawing_type || null;

      let logicalDrawingId: string | null = null;
      if (sheetId) {
        // Try to find existing
        const { data: existing } = await supabase
          .from("logical_drawings")
          .select("id")
          .eq("user_id", userId)
          .eq("project_id", project_id)
          .eq("sheet_id", sheetId)
          .eq("drawing_type", drawingType || "")
          .maybeSingle();

        if (existing) {
          logicalDrawingId = existing.id;
        } else {
          const { data: created } = await supabase
            .from("logical_drawings")
            .insert({
              user_id: userId,
              project_id,
              sheet_id: sheetId,
              discipline,
              drawing_type: drawingType,
            })
            .select("id")
            .single();
          logicalDrawingId = created?.id || null;
        }
      }

      // Insert search index entry via RPC
      const { error } = await supabase.rpc("upsert_search_index", {
        p_user_id: userId,
        p_project_id: project_id,
        p_logical_drawing_id: logicalDrawingId,
        p_document_version_id: document_version_id || null,
        p_page_number: page.page_number || null,
        p_raw_text: rawText,
        p_extracted_entities: {
          bar_marks: barMarks,
          tables: page.tables || [],
          title_block: tb,
        },
        p_bar_marks: barMarks,
        p_crm_deal_id: crm_deal_id || null,
        p_revision_label: tb.revision_code || null,
        p_issue_status: null,
      });

      if (error) {
        console.error(`Index page ${page.page_number} error:`, error);
      } else {
        indexed++;
      }
    }

    return new Response(JSON.stringify({ indexed, total: pages.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("populate-search-index error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
