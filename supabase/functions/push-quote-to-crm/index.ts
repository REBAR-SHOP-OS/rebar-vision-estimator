import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { quote_id, crm_deal_id } = await req.json();
    if (!quote_id || !crm_deal_id) {
      return new Response(JSON.stringify({ error: "quote_id and crm_deal_id required" }), { status: 400, headers: corsHeaders });
    }

    // Fetch quote
    const { data: quote, error: qErr } = await supabase
      .from("quote_versions")
      .select("*")
      .eq("id", quote_id)
      .single();

    if (qErr || !quote) {
      return new Response(JSON.stringify({ error: "Quote not found" }), { status: 404, headers: corsHeaders });
    }

    // Push to Odoo via JSON-RPC
    const odooUrl = Deno.env.get("ODOO_URL");
    const odooDb = Deno.env.get("ODOO_DATABASE");
    const odooUser = Deno.env.get("ODOO_USERNAME");
    const odooKey = Deno.env.get("ODOO_API_KEY");

    if (!odooUrl || !odooDb || !odooUser || !odooKey) {
      // No Odoo config — just update local CRM deal
      const { error: updateErr } = await supabase
        .from("crm_deals")
        .update({
          deal_value: quote.quoted_price,
          stage: "quoted",
          status: "quoted",
          metadata: { last_quote_id: quote_id, last_quote_version: quote.version_number },
        })
        .eq("crm_deal_id", crm_deal_id);

      return new Response(JSON.stringify({
        success: true,
        method: "local_only",
        message: "Updated local CRM deal (no Odoo configured)",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Authenticate with Odoo
    const authResp = await fetch(`${odooUrl}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "call", id: 1,
        params: { service: "common", method: "authenticate", args: [odooDb, odooUser, odooKey, {}] },
      }),
    });
    const authData = await authResp.json();
    const uid = authData.result;

    if (!uid) {
      return new Response(JSON.stringify({ error: "Odoo auth failed" }), { status: 502, headers: corsHeaders });
    }

    // Update lead expected_revenue in Odoo
    const writeResp = await fetch(`${odooUrl}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "call", id: 2,
        params: {
          service: "object", method: "execute_kw",
          args: [odooDb, uid, odooKey, "crm.lead", "write", [[parseInt(crm_deal_id)], {
            expected_revenue: quote.quoted_price || 0,
            description: `Quote v${quote.version_number} — ${quote.currency || "CAD"} $${(quote.quoted_price || 0).toFixed(2)}\n${quote.terms_text || ""}`,
          }]],
        },
      }),
    });
    const writeData = await writeResp.json();

    // Update local deal too
    await supabase.from("crm_deals").update({
      deal_value: quote.quoted_price,
      stage: "quoted",
      metadata: { last_quote_id: quote_id, odoo_synced: true },
    }).eq("crm_deal_id", crm_deal_id);

    return new Response(JSON.stringify({
      success: true,
      method: "odoo",
      odoo_result: writeData.result,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
