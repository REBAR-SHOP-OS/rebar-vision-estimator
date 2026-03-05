import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CRM_BASE = "https://api.pipelinecrm.com/api/v3";

async function crmFetch(path: string, apiKey: string, params?: Record<string, string>) {
  const url = new URL(`${CRM_BASE}${path}`);
  url.searchParams.set("api_key", apiKey);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pipeline CRM API error ${res.status}: ${text}`);
  }
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const PIPELINE_CRM_API_KEY = Deno.env.get("PIPELINE_CRM_API_KEY");
    if (!PIPELINE_CRM_API_KEY) {
      throw new Error("PIPELINE_CRM_API_KEY not configured");
    }

    const { action, deal_id, page, per_page } = await req.json();

    switch (action) {
      case "list_deals": {
        const data = await crmFetch("/deals.json", PIPELINE_CRM_API_KEY, {
          page: String(page || 1),
          per_page: String(Math.min(per_page || 200, 200)),
        });
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_deal": {
        if (!deal_id) throw new Error("deal_id required");
        const data = await crmFetch(`/deals/${deal_id}.json`, PIPELINE_CRM_API_KEY);
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "list_files": {
        const params: Record<string, string> = {
          page: String(page || 1),
          per_page: String(Math.min(per_page || 200, 200)),
        };
        if (deal_id) params["deal_id"] = String(deal_id);
        const data = await crmFetch("/documents.json", PIPELINE_CRM_API_KEY, params);
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_file": {
        if (!deal_id) throw new Error("file id required in deal_id field");
        const data = await crmFetch(`/documents/${deal_id}.json`, PIPELINE_CRM_API_KEY);
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sync_deals": {
        // Get auth user from JWT
        const authHeader = req.headers.get("Authorization");
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Decode user from token
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader || "" } },
        });
        const { data: { user }, error: userErr } = await userClient.auth.getUser();
        if (userErr || !user) throw new Error("Unauthorized");

        // Paginate all deals
        let allDeals: any[] = [];
        let currentPage = 1;
        let hasMore = true;
        while (hasMore) {
          const data = await crmFetch("/deals.json", PIPELINE_CRM_API_KEY, {
            page: String(currentPage),
            per_page: "200",
          });
          const entries = data.entries || data;
          if (Array.isArray(entries) && entries.length > 0) {
            allDeals.push(...entries);
            currentPage++;
            if (entries.length < 200) hasMore = false;
          } else {
            hasMore = false;
          }
        }

        // Upsert into crm_deals
        let upsertCount = 0;
        for (const deal of allDeals) {
          const row = {
            user_id: user.id,
            crm_deal_id: String(deal.id),
            deal_name: deal.name || null,
            deal_value: deal.value ? Number(deal.value) : null,
            stage: deal.deal_stage?.name || deal.stage_name || null,
            status: deal.status?.toString() || null,
            close_date: deal.expected_close_date || deal.close_date || null,
            company_name: deal.company?.name || deal.primary_contact?.company || null,
            synced_at: new Date().toISOString(),
            metadata: {
              owner: deal.user?.first_name ? `${deal.user.first_name} ${deal.user.last_name || ""}`.trim() : null,
              source: deal.source?.name || null,
              created_at: deal.created_at,
              updated_at: deal.updated_at,
            },
          };

          const { error } = await supabase
            .from("crm_deals")
            .upsert(row, { onConflict: "user_id,crm_deal_id" });

          if (error) {
            console.error(`Upsert error for deal ${deal.id}:`, error.message);
          } else {
            upsertCount++;
          }
        }

        return new Response(JSON.stringify({
          synced: upsertCount,
          total_fetched: allDeals.length,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (e) {
    console.error("pipeline-crm error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
