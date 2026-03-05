import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// djb2 hash for system prompt versioning
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Registry mirroring actual production configurations from each edge function
const integrations = [
  {
    provider: "google/gemini",
    gateway: "Lovable AI Gateway",
    gateway_url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    model: "google/gemini-2.5-pro",
    task: "pdf_parsing_and_estimation",
    route: "analyze-blueprint",
    temperature: null as number | null,
    max_tokens: null as number | null,
    stream: true,
    system_prompt: "You are an expert structural/civil engineer and rebar estimator.",
    role: "default" as const,
    config_source: "analyze-blueprint/index.ts",
    probe_type: "gateway" as const,
  },
  {
    provider: "google-cloud-vision",
    gateway: "Direct (Service Account)",
    gateway_url: "https://vision.googleapis.com/v1/images:annotate",
    model: "Cloud Vision API v1",
    task: "ocr_scanned_pages",
    route: "analyze-blueprint",
    temperature: null as number | null,
    max_tokens: null as number | null,
    stream: false,
    system_prompt: "",
    role: "default" as const,
    config_source: "analyze-blueprint/index.ts",
    probe_type: "vision" as const,
  },
  {
    provider: "google/gemini",
    gateway: "Lovable AI Gateway",
    gateway_url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    model: "google/gemini-2.5-flash",
    task: "project_type_classification",
    route: "detect-project-type",
    temperature: null as number | null,
    max_tokens: null as number | null,
    stream: false,
    system_prompt: "You are an expert at classifying construction project types from blueprint pages.",
    role: "default" as const,
    config_source: "detect-project-type/index.ts",
    probe_type: "gateway" as const,
  },
  {
    provider: "google-cloud-vision",
    gateway: "Direct (Service Account)",
    gateway_url: "https://vision.googleapis.com/v1/images:annotate",
    model: "Cloud Vision API v1",
    task: "ocr_blueprint_thumbnails",
    route: "detect-project-type",
    temperature: null as number | null,
    max_tokens: null as number | null,
    stream: false,
    system_prompt: "",
    role: "default" as const,
    config_source: "detect-project-type/index.ts",
    probe_type: "vision" as const,
  },
  {
    provider: "google/gemini",
    gateway: "Lovable AI Gateway",
    gateway_url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    model: "google/gemini-3-flash-preview",
    task: "shop_drawing_generation",
    route: "generate-shop-drawing",
    temperature: null as number | null,
    max_tokens: null as number | null,
    stream: false,
    system_prompt: "You are a professional rebar detailing engineer. Output only valid HTML documents.",
    role: "default" as const,
    config_source: "generate-shop-drawing/index.ts",
    probe_type: "gateway" as const,
  },
  {
    provider: "google/gemini",
    gateway: "Lovable AI Gateway",
    gateway_url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    model: "google/gemini-2.5-flash-lite",
    task: "conversation_learning_extraction",
    route: "extract-learning",
    temperature: null as number | null,
    max_tokens: null as number | null,
    stream: false,
    system_prompt: "Extract concise learnings from conversations. Be brief and actionable.",
    role: "default" as const,
    config_source: "extract-learning/index.ts",
    probe_type: "gateway" as const,
  },
  {
    provider: "google/gemini",
    gateway: "Lovable AI Gateway",
    gateway_url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    model: "google/gemini-2.5-flash",
    task: "estimation_accuracy_analysis",
    route: "analyze-outcomes",
    temperature: null as number | null,
    max_tokens: null as number | null,
    stream: false,
    system_prompt: "You are a construction estimation expert specializing in rebar takeoff accuracy analysis. Return only valid JSON.",
    role: "default" as const,
    config_source: "analyze-outcomes/index.ts",
    probe_type: "gateway" as const,
  },
];

// Safety guard: validate no placeholders
function validateIntegrations() {
  const failures: string[] = [];
  for (const i of integrations) {
    if (!i.model || i.model === "unknown" || i.model.includes("placeholder")) {
      failures.push(`${i.route}/${i.task}: model is "${i.model}"`);
    }
    if (!i.provider) failures.push(`${i.route}/${i.task}: provider is empty`);
    if (!i.gateway) failures.push(`${i.route}/${i.task}: gateway is empty`);
  }
  return failures;
}

function buildManifest() {
  return integrations.map((i) => ({
    provider: i.provider,
    gateway: i.gateway,
    model: i.model,
    task: i.task,
    route: i.route,
    temperature: i.temperature,
    max_tokens: i.max_tokens,
    stream: i.stream,
    system_prompt_hash: i.system_prompt ? djb2Hash(i.system_prompt) : null,
    role: i.role,
    config_source: i.config_source,
  }));
}

function buildSummary() {
  const models = [...new Set(integrations.map((i) => i.model))];
  const gateways = [...new Set(integrations.map((i) => i.gateway))];
  const providers = [...new Set(integrations.map((i) => i.provider))];
  return {
    total_providers: providers.length,
    total_models: models.length,
    total_integrations: integrations.length,
    gateways,
    models,
    providers,
  };
}

// Probe a Lovable AI Gateway integration with a 1-token request
async function probeGateway(integration: typeof integrations[0]) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return { success: false, error: "LOVABLE_API_KEY not configured", latency_ms: 0, resolved_model: null, gateway_headers: {} };

  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(integration.gateway_url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: integration.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });

    const latency_ms = Math.round(performance.now() - start);

    // Extract safe headers
    const safeHeaderKeys = ["content-type", "x-request-id", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];
    const gateway_headers: Record<string, string> = {};
    for (const key of safeHeaderKeys) {
      const val = res.headers.get(key);
      if (val) gateway_headers[key] = val;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { success: false, error: `HTTP ${res.status}: ${errText.substring(0, 200)}`, latency_ms, resolved_model: null, gateway_headers };
    }

    const data = await res.json();
    const resolved_model = data.model || integration.model;

    return { success: true, latency_ms, resolved_model, gateway_headers, error: null };
  } catch (e) {
    const latency_ms = Math.round(performance.now() - start);
    return { success: false, error: e instanceof Error ? e.message : "Unknown error", latency_ms, resolved_model: null, gateway_headers: {} };
  } finally {
    clearTimeout(timeout);
  }
}

// Probe Google Cloud Vision by checking env var and sending a minimal request
function safeParseSAKey(raw: string): { parsed: Record<string, unknown> | null; error: string | null; method: string } {
  // Strip BOM and trim whitespace
  const cleaned = raw.replace(/^\uFEFF/, "").trim();

  // Attempt 1: direct parse
  try {
    const obj = JSON.parse(cleaned);
    if (typeof obj === "object" && obj !== null) return { parsed: obj, error: null, method: "direct" };
    // If parse returned a string, it was double-encoded
    if (typeof obj === "string") {
      const inner = JSON.parse(obj);
      if (typeof inner === "object" && inner !== null) return { parsed: inner, error: null, method: "double-encoded" };
    }
    return { parsed: null, error: "Parsed value is not an object", method: "direct" };
  } catch (_e1) {
    // Attempt 2: maybe it's double-encoded with outer quotes
    try {
      const unwrapped = JSON.parse(`"${cleaned}"`);
      const obj = JSON.parse(unwrapped);
      if (typeof obj === "object" && obj !== null) return { parsed: obj, error: null, method: "double-encoded-alt" };
    } catch (_e2) {
      // fall through
    }
    return {
      parsed: null,
      error: `JSON parse failed: ${_e1 instanceof Error ? _e1.message : "unknown"}`,
      method: "failed",
    };
  }
}

// 1x1 transparent PNG as base64
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRUSErkJggg==";

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createGoogleJWT(sa: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-vision",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 300,
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import RSA private key
  const pemBody = (sa.private_key as string)
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(signingInput))
  );

  return `${signingInput}.${base64url(signature)}`;
}

async function exchangeJWTForToken(jwt: string): Promise<{ access_token: string } | { error: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { error: `Token exchange HTTP ${res.status}: ${t.substring(0, 200)}` };
  }
  const data = await res.json();
  if (!data.access_token) return { error: "No access_token in response" };
  return { access_token: data.access_token };
}

function classifyHttpStatus(status: number): string {
  if (status === 401 || status === 403) return "auth_error";
  if (status === 429) return "quota_error";
  if (status === 400) return "bad_request";
  return "unknown_error";
}

async function probeVision(_integration: typeof integrations[0]) {
  const saKey = Deno.env.get("GOOGLE_VISION_SA_KEY");
  if (!saKey) return { success: false, error: "GOOGLE_VISION_SA_KEY not configured", latency_ms: 0, resolved_model: "Cloud Vision API v1", gateway_headers: {} };

  const start = performance.now();

  // Step 1: Parse SA key
  const { parsed: sa, error: parseError, method } = safeParseSAKey(saKey);
  if (!sa) {
    const latency_ms = Math.round(performance.now() - start);
    const firstChars = saKey.substring(0, 20).replace(/[^ -~]/g, "?");
    return { success: false, error: `${parseError} | first_chars: "${firstChars}" | length: ${saKey.length}`, latency_ms, resolved_model: "Cloud Vision API v1", gateway_headers: { parse_method: method } };
  }

  // Step 2: Get access token via JWT
  let accessToken: string;
  try {
    const jwt = await createGoogleJWT(sa);
    const tokenResult = await exchangeJWTForToken(jwt);
    if ("error" in tokenResult) {
      const latency_ms = Math.round(performance.now() - start);
      return { success: false, error: tokenResult.error, error_class: "auth_error", latency_ms, resolved_model: "Cloud Vision API v1", gateway_headers: { parse_method: method } };
    }
    accessToken = tokenResult.access_token;
  } catch (e) {
    const latency_ms = Math.round(performance.now() - start);
    return { success: false, error: e instanceof Error ? e.message : "JWT/token error", error_class: "auth_error", latency_ms, resolved_model: "Cloud Vision API v1", gateway_headers: { parse_method: method } };
  }

  // Step 3: Call Vision API with tiny image
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const visionRes = await fetch("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ image: { content: TINY_PNG_B64 }, features: [{ type: "TEXT_DETECTION", maxResults: 1 }] }],
      }),
      signal: controller.signal,
    });

    const latency_ms = Math.round(performance.now() - start);
    const contentType = visionRes.headers.get("content-type") || "";
    const rawText = await visionRes.text();

    if (!visionRes.ok) {
      const error_class = classifyHttpStatus(visionRes.status);
      return { success: false, error: `HTTP ${visionRes.status}`, error_class, latency_ms, resolved_model: "Cloud Vision API v1", gateway_headers: { http_status: String(visionRes.status), content_type: contentType, response_snippet: rawText.substring(0, 200), parse_method: method } };
    }

    if (!contentType.includes("application/json")) {
      return { success: false, error: "Non-JSON response from Vision API", error_class: "non_json_response", latency_ms, resolved_model: "Cloud Vision API v1", gateway_headers: { http_status: String(visionRes.status), content_type: contentType, response_snippet: rawText.substring(0, 200), parse_method: method } };
    }

    let data: Record<string, unknown>;
    try { data = JSON.parse(rawText); } catch { return { success: false, error: "Failed to parse Vision response JSON", error_class: "non_json_response", latency_ms, resolved_model: "Cloud Vision API v1", gateway_headers: { content_type: contentType, response_snippet: rawText.substring(0, 200), parse_method: method } }; }

    if (Array.isArray(data.responses)) {
      return { success: true, latency_ms, resolved_model: "Cloud Vision API v1", gateway_headers: { parse_method: method, client_email: sa.client_email ? "configured" : "missing", response_count: String((data.responses as unknown[]).length) }, error: null };
    }

    return { success: false, error: "Missing 'responses' array in Vision API response", latency_ms, resolved_model: "Cloud Vision API v1", gateway_headers: { parse_method: method, response_snippet: rawText.substring(0, 200) } };
  } catch (e) {
    const latency_ms = Math.round(performance.now() - start);
    const isTimeout = e instanceof DOMException && e.name === "AbortError";
    return { success: false, error: e instanceof Error ? e.message : "Unknown", error_class: isTimeout ? "timeout" : "network_error", latency_ms, resolved_model: "Cloud Vision API v1", gateway_headers: { parse_method: method } };
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Safety guard
  const failures = validateIntegrations();
  if (failures.length > 0) {
    return new Response(JSON.stringify({
      error: "STATIC_PLACEHOLDER_DETECTED",
      details: failures,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const verify = url.searchParams.get("verify") === "true";

  const manifest = buildManifest();
  const summary = buildSummary();

  if (!verify) {
    return new Response(JSON.stringify({
      integrations: manifest,
      summary,
      validated: true,
      timestamp: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Run probes in parallel
  const probePromises = integrations.map(async (integration) => {
    const key = `${integration.route}/${integration.model}`;
    const result = integration.probe_type === "vision"
      ? await probeVision(integration)
      : await probeGateway(integration);
    return { integration: key, ...result };
  });

  const probeResults = await Promise.allSettled(probePromises);
  const probes = probeResults.map((r) =>
    r.status === "fulfilled" ? r.value : { integration: "unknown", success: false, error: "Probe rejected", latency_ms: 0, resolved_model: null, gateway_headers: {} }
  );

  const all_probes_passed = probes.every((p) => p.success);

  return new Response(JSON.stringify({
    integrations: manifest,
    probes,
    all_probes_passed,
    summary,
    validated: true,
    timestamp: new Date().toISOString(),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
