import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REBAR_URL = "https://rzqonxnowjrtbueauziu.supabase.co";
const REBAR_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6cW9ueG5vd2pydGJ1ZWF1eml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODE2NTMsImV4cCI6MjA4NzE1NzY1M30.3-ryGO4oXzW_4NET5cKYrw0hAI8oY4vvYnuYp5Q6NkY";

const TARGET_STAGES = [
  "estimation_ben",
  "estimation_karthick",
  "hot_enquiries",
  "qualified",
];

const LEAD_FILES_TABLE = "lead_files";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rebarClient = createClient(REBAR_URL, REBAR_ANON_KEY);

    // Fetch leads from target stages
    const { data: leads, error } = await rebarClient
      .from("leads")
      .select("id, title, stage, expected_value, expected_close_date, priority, probability, source, created_at, customer_id, customers(name, company_name)")
      .in("stage", TARGET_STAGES)
      .order("expected_value", { ascending: false, nullsFirst: false });

    if (error) {
      console.error("Failed to fetch leads:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For each lead, check lead_files table for attachments
    const leadIds = (leads || []).map((l: any) => l.id);
    const { data: allFiles } = await rebarClient
      .from(LEAD_FILES_TABLE)
      .select("*")
      .in("lead_id", leadIds.length > 0 ? leadIds : ["__none__"]);

    // Group files by lead_id
    const filesByLead: Record<string, any[]> = {};
    for (const file of allFiles || []) {
      if (!filesByLead[file.lead_id]) filesByLead[file.lead_id] = [];
      filesByLead[file.lead_id].push(file);
    }

    const leadsWithFiles = (leads || []).map((lead: any) => ({
      ...lead,
      attachments: (filesByLead[lead.id] || []).map((f: any) => ({
        name: f.file_name || f.name || "file",
        size: f.file_size || f.size || 0,
        mimeType: f.mime_type || f.content_type || "application/octet-stream",
        url: f.file_url || f.url || f.public_url || null,
      })),
    }));

    return new Response(JSON.stringify({ leads: leadsWithFiles }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
