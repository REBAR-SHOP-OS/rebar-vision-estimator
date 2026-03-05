const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_HOSTS = [
  "rebarshop-24-rebar-shop.odoo.com",
  "ylfvyurpqplbijjfuuns.supabase.co",
  "wqfagcjplpeaxzwoftjn.supabase.co",
  "rzqonxnowjrtbueauziu.supabase.co",
];

function getOdooCreds() {
  const rawUrl = Deno.env.get("ODOO_URL")!;
  return {
    url: new URL(rawUrl.trim()).origin,
    db: Deno.env.get("ODOO_DATABASE")!,
    login: Deno.env.get("ODOO_USERNAME")!,
    apiKey: Deno.env.get("ODOO_API_KEY")!,
  };
}

async function fetchOdooAttachment(odooId: string) {
  const odoo = getOdooCreds();

  // Fetch metadata + binary in parallel via JSON-RPC
  const makeRpc = (fields: string[]) =>
    fetch(`${odoo.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${odoo.apiKey}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        id: Date.now(),
        params: {
          service: "object",
          method: "execute_kw",
          args: [odoo.db, 2, odoo.apiKey, "ir.attachment", "read",
            [[parseInt(odooId)]], { fields }],
        },
      }),
    }).then((r) => r.json());

  const [metaJson, dataJson] = await Promise.all([
    makeRpc(["name", "mimetype"]),
    makeRpc(["datas"]),
  ]);

  const meta = metaJson?.result?.[0];
  const dataRec = dataJson?.result?.[0];
  if (!meta || !dataRec?.datas) {
    throw new Error(`Attachment ${odooId} not found or empty`);
  }

  const binaryStr = atob(dataRec.datas);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return {
    bytes,
    mimeType: meta.mimetype || "application/octet-stream",
    fileName: meta.name || `file-${odooId}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { url, odoo_id } = body;

    // Mode 1: Fetch by Odoo attachment ID directly via JSON-RPC
    if (odoo_id) {
      const result = await fetchOdooAttachment(String(odoo_id));
      return new Response(result.bytes, {
        headers: {
          ...corsHeaders,
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename="${result.fileName}"`,
          "Content-Length": String(result.bytes.byteLength),
        },
      });
    }

    // Mode 2: Proxy a URL (for storage/non-Odoo URLs)
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "Missing url or odoo_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = new URL(url);
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return new Response(JSON.stringify({ error: "Host not allowed" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ error: `Upstream ${upstream.status}` }),
        { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const respBody = await upstream.arrayBuffer();

    return new Response(respBody, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Length": String(respBody.byteLength),
      },
    });
  } catch (err) {
    console.error("proxy-crm-file error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
