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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rebarClient = createClient(REBAR_URL, REBAR_ANON_KEY);

    // First, discover what stages exist
    const { data: allLeads, error: discoverError } = await rebarClient
      .from("leads")
      .select("stage")
      .limit(500);

    console.log("Discover error:", JSON.stringify(discoverError));
    console.log("All leads count:", allLeads?.length);
    const uniqueStages = [...new Set((allLeads || []).map((l: any) => l.stage))];
    console.log("Available stages:", JSON.stringify(uniqueStages));

    // Fetch leads from target stages
    const { data: leads, error } = await rebarClient
      .from("leads")
      .select("id, title, stage, expected_value, expected_close_date, priority, probability, source, created_at, customer_id, customers(name, company_name)")
      .in("stage", TARGET_STAGES)
      .order("expected_value", { ascending: false, nullsFirst: false });
    
    console.log("Leads error:", JSON.stringify(error));
    console.log("Leads count:", leads?.length);

    if (error) {
      console.error("Failed to fetch leads:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ 
      leads: leads || [],
      _debug: {
        discoverError,
        allLeadsCount: allLeads?.length,
        uniqueStages,
        leadsError: error,
        matchedCount: leads?.length,
      }
    }), {
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
