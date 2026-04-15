import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const REBAR_URL = "https://rzqonxnowjrtbueauziu.supabase.co";
const REBAR_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6cW9ueG5vd2pydGJ1ZWF1eml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODE2NTMsImV4cCI6MjA4NzE1NzY1M30.3-ryGO4oXzW_4NET5cKYrw0hAI8oY4vvYnuYp5Q6NkY";

const TARGET_STAGES = [
  "estimation_ben",
  "estimation_karthick",
  "hot_enquiries",
  "qualified",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
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
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const leadIds = (leads || []).map((l: any) => l.id);
    const filesByLead: Record<string, any[]> = {};
    let totalFilesFound = 0;

    // Batch lead_files queries in chunks of 30 to stay within URL limits
    for (let i = 0; i < leadIds.length; i += 30) {
      const batch = leadIds.slice(i, i + 30);
      const { data: files, error: filesError } = await rebarClient
        .from("lead_files")
        .select("id, lead_id, file_name, file_url, storage_path, mime_type, odoo_id, file_size_bytes")
        .in("lead_id", batch)
        .limit(500);

      if (filesError) {
        console.error(`Files batch error:`, filesError.message);
        continue;
      }

      for (const file of files || []) {
        if (!filesByLead[file.lead_id]) filesByLead[file.lead_id] = [];
        filesByLead[file.lead_id].push(file);
        totalFilesFound++;
      }
    }

    console.log(`Total files found: ${totalFilesFound} across ${Object.keys(filesByLead).length} leads`);

    const leadsWithFiles = (leads || []).map((lead: any) => {
      const files = filesByLead[lead.id] || [];
      const attachments = files.map((f: any) => {
        let url: string | null = null;
        let odooId: string | null = null;

        // Prefer storage path (direct public download)
        if (f.storage_path) {
          url = `${REBAR_URL}/storage/v1/object/public/lead-files/${f.storage_path}`;
        }
        // Use odoo_id for Odoo-hosted files
        else if (f.odoo_id) {
          odooId = String(f.odoo_id);
        }
        // Extract content ID from Odoo URLs
        else if (f.file_url && f.file_url.includes("odoo.com/web/content/")) {
          const match = f.file_url.match(/\/web\/content\/(\d+)/);
          if (match) odooId = match[1];
        }
        // Non-Odoo URL fallback
        else if (f.file_url) {
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
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
