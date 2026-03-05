import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REBAR_URL = "https://rzqonxnowjrtbueauziu.supabase.co";
const REBAR_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6cW9ueG5vd2pydGJ1ZWF1eml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODE2NTMsImV4cCI6MjA4NzE1NzY1M30.3-ryGO4oXzW_4NET5cKYrw0hAI8oY4vvYnuYp5Q6NkY";

const LEARNING_STAGES = [
  "delivered_pickup_done",
  "won",
  "no_rebars_out_of_scope",
];

const OUTCOME_MAP: Record<string, string> = {
  delivered_pickup_done: "SUCCESS",
  won: "SUCCESS",
  no_rebars_out_of_scope: "FAIL",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const singleLeadId = body.lead_id || null;
    const userId = body.user_id;

    if (!userId) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rebarClient = createClient(REBAR_URL, REBAR_ANON_KEY);
    const localUrl = Deno.env.get("SUPABASE_URL")!;
    const localKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const localClient = createClient(localUrl, localKey);

    // Fetch leads — either single or all in learning stages
    let leads: any[] = [];
    if (singleLeadId) {
      const { data, error } = await rebarClient
        .from("leads")
        .select("*, customers(name, company_name)")
        .eq("id", singleLeadId)
        .single();
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      leads = [data];
    } else {
      const { data, error } = await rebarClient
        .from("leads")
        .select("*, customers(name, company_name)")
        .in("stage", LEARNING_STAGES)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      leads = data || [];
    }

    // Fetch existing learned lead_ids to avoid duplicates
    const { data: existing } = await localClient
      .from("agent_knowledge")
      .select("content")
      .eq("type", "learned")
      .eq("user_id", userId);

    const existingLeadIds = new Set<string>();
    for (const row of existing || []) {
      try {
        const parsed = JSON.parse(row.content || "{}");
        if (parsed.lead_id) existingLeadIds.add(String(parsed.lead_id));
      } catch {}
    }

    // Fetch files for all leads
    const leadIds = leads.map((l: any) => l.id);
    const filesByLead: Record<string, any[]> = {};
    for (let i = 0; i < leadIds.length; i += 30) {
      const batch = leadIds.slice(i, i + 30);
      const { data: files } = await rebarClient
        .from("lead_files")
        .select("id, lead_id, file_name, mime_type, file_size_bytes")
        .in("lead_id", batch);
      for (const f of files || []) {
        if (!filesByLead[f.lead_id]) filesByLead[f.lead_id] = [];
        filesByLead[f.lead_id].push(f);
      }
    }

    let newCount = 0;
    const errors: string[] = [];

    for (const lead of leads) {
      const leadIdStr = String(lead.id);
      if (existingLeadIds.has(leadIdStr) && !singleLeadId) continue; // skip duplicates unless forced single

      const outcome = OUTCOME_MAP[lead.stage] || "PENDING";
      const files = filesByLead[lead.id] || [];
      const caseRecord = {
        lead_id: lead.id,
        title: lead.title,
        customer: lead.customers?.company_name || lead.customers?.name || null,
        stage: lead.stage,
        outcome,
        expected_value: lead.expected_value,
        created_at: lead.created_at,
        files_count: files.length,
        files_metadata: files.map((f: any) => ({
          name: f.file_name,
          mime: f.mime_type,
          size: f.file_size_bytes,
        })),
      };

      const title = `Pipeline Case: ${lead.title || leadIdStr} [${outcome}]`;
      const content = JSON.stringify(caseRecord);

      // Upsert: if single lead forced, update existing
      if (singleLeadId && existingLeadIds.has(leadIdStr)) {
        const { error } = await localClient
          .from("agent_knowledge")
          .update({ content, title })
          .eq("type", "learned")
          .eq("user_id", userId)
          .ilike("content", `%"lead_id":"${leadIdStr}"%`);
        if (error) errors.push(`Update ${leadIdStr}: ${error.message}`);
        else newCount++;
      } else {
        const { error } = await localClient
          .from("agent_knowledge")
          .insert({
            user_id: userId,
            type: "learned",
            title,
            content,
          });
        if (error) errors.push(`Insert ${leadIdStr}: ${error.message}`);
        else newCount++;
      }
    }

    return new Response(JSON.stringify({
      learned: newCount,
      total_candidates: leads.length,
      skipped_duplicates: leads.length - newCount - errors.length,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("learn-from-pipeline error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
