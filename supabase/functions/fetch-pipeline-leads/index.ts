import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// REBAR SHOP OS publishable credentials
const REBAR_URL = "https://rzqonxnowjrtbueauziu.supabase.co";
const REBAR_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6cW9ueG5vd2pydGJ1ZWF1eml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODE2NTMsImV4cCI6MjA4NzE1NzY1M30.3-ryGO4oXzW_4NET5cKYrw0hAI8oY4vvYnuYp5Q6NkY";

// Only fetch from these specific stages
const TARGET_STAGES = [
  "estimation_ben",
  "estimation_karthick",
  "hot_enquiries",
  "qualified",
];

const LEAD_FILES_BUCKET = "lead-files";

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

    // For each lead, check for files in the storage bucket under lead-files/{lead_id}/
    const leadsWithFiles = await Promise.all(
      (leads || []).map(async (lead: any) => {
        try {
          const { data: files, error: storageError } = await rebarClient.storage
            .from(LEAD_FILES_BUCKET)
            .list(lead.id, { limit: 50 });

          if (storageError || !files || files.length === 0) {
            return { ...lead, attachments: [] };
          }

          // Filter out .emptyFolderPlaceholder and build public URLs
          const attachments = files
            .filter((f: any) => f.name !== ".emptyFolderPlaceholder")
            .map((f: any) => {
              const { data: urlData } = rebarClient.storage
                .from(LEAD_FILES_BUCKET)
                .getPublicUrl(`${lead.id}/${f.name}`);
              return {
                name: f.name,
                size: f.metadata?.size || 0,
                mimeType: f.metadata?.mimetype || "application/octet-stream",
                url: urlData?.publicUrl || null,
              };
            })
            .filter((a: any) => a.url);

          return { ...lead, attachments };
        } catch {
          return { ...lead, attachments: [] };
        }
      })
    );

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
