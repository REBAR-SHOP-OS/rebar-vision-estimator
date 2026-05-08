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
          args: [odoo.db, uid, odoo.apiKey, "ir.attachment", "read", [[parseInt(odooId)]], { fields }],
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
    throw new Error(`Attachment ${odooId} not found or empty.`);
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { url, odoo_id, project_id } = body;
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = (await import("https://esm.sh/@supabase/supabase-js@2")).createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = (await import("https://esm.sh/@supabase/supabase-js@2")).createClient(supabaseUrl, serviceKey);
    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .select("id")
      .eq("id", project_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (projectError) {
      console.error("Project lookup error:", projectError);
      return new Response(JSON.stringify({ error: "Failed to verify project access" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!project) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
