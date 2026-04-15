import { corsHeaders } from "../_shared/cors.ts";
const ALLOWED_HOSTS = [
  "rebarshop-24-rebar-shop.odoo.com",
  "ylfvyurpqplbijjfuuns.supabase.co",
  "wqfagcjplpeaxzwoftjn.supabase.co",
  "rzqonxnowjrtbueauziu.supabase.co",
];

function getOdooCreds() {
  const rawUrl = Deno.env.get("ODOO_URL")!;
  return {
    url: new URL(rawUrl.replace(/\s+/g, "")).origin,
    db: Deno.env.get("ODOO_DATABASE")!,
    login: Deno.env.get("ODOO_USERNAME")!,
    apiKey: Deno.env.get("ODOO_API_KEY")!,
  };
}

async function authenticateOdoo(odoo: ReturnType<typeof getOdooCreds>): Promise<number> {
  const resp = await fetch(`${odoo.url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      id: Date.now(),
      params: {
        service: "common",
        method: "authenticate",
        args: [odoo.db, odoo.login, odoo.apiKey, {}],
      },
    }),
  });
  const json = await resp.json();
  console.log("Odoo auth response:", JSON.stringify(json));
  const uid = json?.result;
  if (!uid || typeof uid !== "number") {
    throw new Error(`Odoo authentication failed: ${JSON.stringify(json?.error || json)}`);
  }
  return uid;
}

async function fetchOdooAttachment(odooId: string) {
  const odoo = getOdooCreds();
  const uid = await authenticateOdoo(odoo);

  const makeRpc = (fields: string[]) =>
    fetch(`${odoo.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        id: Date.now(),
        params: {
          service: "object",
          method: "execute_kw",
          args: [odoo.db, uid, odoo.apiKey, "ir.attachment", "read",
            [[parseInt(odooId)]], { fields }],
        },
      }),
    }).then((r) => r.json());

  const [metaJson, dataJson] = await Promise.all([
    makeRpc(["name", "mimetype"]),
    makeRpc(["datas"]),
  ]);

  console.log("Odoo meta response keys:", JSON.stringify({ result: !!metaJson?.result, error: metaJson?.error }));
  console.log("Odoo data response keys:", JSON.stringify({ result: !!dataJson?.result, hasDatas: !!dataJson?.result?.[0]?.datas, error: dataJson?.error }));

  const meta = metaJson?.result?.[0];
  const dataRec = dataJson?.result?.[0];
  if (!meta || !dataRec?.datas) {
    throw new Error(`Attachment ${odooId} not found or empty. Meta: ${JSON.stringify(metaJson?.error || metaJson?.result)}, Data: ${JSON.stringify(dataJson?.error || 'no datas field')}`);
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
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const body = await req.json();
    const { url, odoo_id } = body;

    // Mode 1: Fetch by Odoo attachment ID directly via JSON-RPC
    if (odoo_id) {
      const result = await fetchOdooAttachment(String(odoo_id));
      return new Response(result.bytes, {
        headers: {
          ...corsHeaders(req),
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
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const parsed = new URL(url);
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return new Response(JSON.stringify({ error: "Host not allowed" }), {
        status: 403,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ error: `Upstream ${upstream.status}` }),
        { status: upstream.status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } },
      );
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const respBody = await upstream.arrayBuffer();

    return new Response(respBody, {
      headers: {
        ...corsHeaders(req),
        "Content-Type": contentType,
        "Content-Length": String(respBody.byteLength),
      },
    });
  } catch (err) {
    console.error("proxy-crm-file error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
