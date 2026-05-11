import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rebarUrl = Deno.env.get("PIPELINE_SUPABASE_URL");
    const rebarAnonKey = Deno.env.get("PIPELINE_SUPABASE_ANON_KEY");
    if (!rebarUrl || !rebarAnonKey) {
      return new Response(JSON.stringify({ error: "Pipeline connector is not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rebarClient = createClient(rebarUrl, rebarAnonKey);

    const { data: leads, error } = await rebarClient
      .from("leads")
      .select("id, title, stage, expected_value, expected_close_date, priority, probability, source, created_at, customer_id, customers(name, company_name)")
      .in("stage", TARGET_STAGES)
      .order("expected_value", { ascending: false, nullsFirst: false });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const leadIds = (leads || []).map((l: any) => l.id);
    const filesByLead: Record<string, any[]> = {};
    let totalFilesFound = 0;

    for (let i = 0; i < leadIds.length; i += 30) {
      const batch = leadIds.slice(i, i + 30);
      const { data: files, error: filesError } = await rebarClient
        .from("lead_files")
        .select("id, lead_id, file_name, file_url, storage_path, mime_type, odoo_id, file_size_bytes")
        .in("lead_id", batch)
        .limit(500);

      if (filesError) {
        console.error("Files batch error:", filesError.message);
        continue;
      }

      for (const file of files || []) {
        if (!filesByLead[file.lead_id]) filesByLead[file.lead_id] = [];
        filesByLead[file.lead_id].push(file);
        totalFilesFound++;
      }
    }

    console.log(`Total files found: ${totalFilesFound} across ${Object.keys(filesByLead).length} leads for ${user.id}`);

    const leadsWithFiles = (leads || []).map((lead: any) => {
      const files = filesByLead[lead.id] || [];
      const attachments = files.map((f: any) => {
        let url: string | null = null;
        let odooId: string | null = null;

        if (f.storage_path) {
          url = `${rebarUrl}/storage/v1/object/public/lead-files/${f.storage_path}`;
        } else if (f.odoo_id) {
          odooId = String(f.odoo_id);
        } else if (f.file_url && f.file_url.includes("odoo.com/web/content/")) {
          const match = f.file_url.match(/\/web\/content\/(\d+)/);
          if (match) odooId = match[1];
        } else if (f.file_url) {
          url = f.file_url;
        }

        if (!url && !odooId) return null;

        return {
          name: f.file_name || "file",
          size: f.file_size_bytes || 0,
          mimeType: f.mime_type || "application/octet-stream",
          url,
          odooId,
        };
      }).filter(Boolean);

      return { ...lead, attachments };
    });

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
