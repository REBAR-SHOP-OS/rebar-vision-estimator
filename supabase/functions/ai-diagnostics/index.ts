import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

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
    pinned_model: "google/gemini-2.5-pro",
    is_preview: false,
    is_pinned: true,
    task: "pdf_parsing_and_estimation",
    route: "analyze-blueprint",
    temperature: 0 as number | null,
    top_p: 1 as number | null,
    max_tokens: 16384 as number | null,
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
    pinned_model: "Cloud Vision API v1",
    is_preview: false,
    is_pinned: true,
    task: "ocr_scanned_pages",
    route: "analyze-blueprint",
    temperature: null as number | null,
    top_p: null as number | null,
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
    pinned_model: "google/gemini-2.5-flash",
    is_preview: false,
    is_pinned: true,
    task: "project_type_classification",
    route: "detect-project-type",
    temperature: 0 as number | null,
    top_p: 1 as number | null,
    max_tokens: 2048 as number | null,
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
    pinned_model: "Cloud Vision API v1",
    is_preview: false,
    is_pinned: true,
    task: "ocr_blueprint_thumbnails",
    route: "detect-project-type",
    temperature: null as number | null,
    top_p: null as number | null,
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
    model: "google/gemini-2.5-flash",
    pinned_model: "google/gemini-2.5-flash",
    is_preview: false,
    is_pinned: true,
    task: "shop_drawing_generation",
    route: "generate-shop-drawing",
    temperature: 0.2 as number | null,
    top_p: 1 as number | null,
    max_tokens: 16384 as number | null,
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
    pinned_model: "google/gemini-2.5-flash-lite",
    is_preview: false,
    is_pinned: true,
    task: "conversation_learning_extraction",
    route: "extract-learning",
    temperature: 0 as number | null,
    top_p: 1 as number | null,
    max_tokens: 1024 as number | null,
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
    pinned_model: "google/gemini-2.5-flash",
    is_preview: false,
    is_pinned: true,
    task: "estimation_accuracy_analysis",
    route: "analyze-outcomes",
    temperature: 0 as number | null,
    top_p: 1 as number | null,
    max_tokens: 4096 as number | null,
    stream: false,
    system_prompt: "You are a construction estimation expert specializing in rebar takeoff accuracy analysis. Return only valid JSON.",
    role: "default" as const,
    config_source: "analyze-outcomes/index.ts",
    probe_type: "gateway" as const,
  },
];

// Safety guard: validate no placeholders and no preview models in production
function validateIntegrations(strict = false) {
  const failures: string[] = [];
  for (const i of integrations) {
    if (!i.model || i.model === "unknown" || i.model.includes("placeholder")) {
      failures.push(`${i.route}/${i.task}: model is "${i.model}"`);
    }
    if (!i.provider) failures.push(`${i.route}/${i.task}: provider is empty`);
    if (!i.gateway) failures.push(`${i.route}/${i.task}: gateway is empty`);
    if (strict) {
      if (i.is_preview) {
        failures.push(`${i.route}/${i.task}: model "${i.model}" is a preview model (not production-stable)`);
      }
      if (!i.is_pinned) {
        failures.push(`${i.route}/${i.task}: model "${i.model}" is not pinned`);
      }
    }
  }
  return failures;
}

function buildManifest() {
  return integrations.map((i) => ({
    provider: i.provider,
    gateway: i.gateway,
    model: i.model,
    pinned_model: i.pinned_model,
    is_preview: i.is_preview,
    is_pinned: i.is_pinned,
    task: i.task,
    route: i.route,
    temperature: i.temperature,
    top_p: i.top_p,
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
function validateSAKey(obj: Record<string, unknown>): string | null {
  if (!obj.client_email) return "Missing required field: client_email";
  if (!obj.private_key) return "Missing required field: private_key";
  if (typeof obj.private_key === "string" && !obj.private_key.includes("BEGIN PRIVATE KEY")) {
    return "private_key does not contain 'BEGIN PRIVATE KEY' header";
  }
  return null;
}

function safeParseSAKey(raw: string): { parsed: Record<string, unknown> | null; error: string | null; method: string; hint?: string } {
  const cleaned = raw.replace(/^\uFEFF/, "").trim();

  if (!cleaned) return { parsed: null, error: "Empty value", method: "failed" };

  // Helper: try JSON parse and validate
  const tryParseAndValidate = (str: string, method: string): { parsed: Record<string, unknown> | null; error: string | null; method: string } | null => {
    try {
      const obj = JSON.parse(str);
      if (typeof obj === "object" && obj !== null) {
        const valErr = validateSAKey(obj);
        if (valErr) return { parsed: null, error: `SA key parsed (${method}) but invalid: ${valErr}`, method };
        return { parsed: obj, error: null, method };
      }
      if (typeof obj === "string") {
        // double-encoded
        return tryParseAndValidate(obj, "double-encoded");
      }
    } catch { /* fall through */ }
    return null;
  };

  // Attempt 1: direct JSON (starts with "{")
  if (cleaned.startsWith("{")) {
    const result = tryParseAndValidate(cleaned, "direct");
    if (result) return result;
    return { parsed: null, error: "Starts with '{' but JSON parse failed", method: "failed" };
  }

  // Attempt 2: base64 decode then JSON parse
  const isBase64 = /^[A-Za-z0-9+/\r\n]+=*$/.test(cleaned) && cleaned.length > 50;
  if (isBase64) {
    try {
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(cleaned), c => c.charCodeAt(0)));
      const result = tryParseAndValidate(decoded, "base64");
      if (result) return result;
    } catch { /* not valid base64 */ }
  }

  // Attempt 3: double-encoded with outer quotes
  try {
    const unwrapped = JSON.parse(`"${cleaned}"`);
    const result = tryParseAndValidate(unwrapped, "double-encoded-alt");
    if (result) return result;
  } catch { /* fall through */ }

  // Descriptive failure
  const looks = /^[0-9a-f]+$/i.test(cleaned) ? `${cleaned.length}-char hex string` : `${cleaned.length}-char non-JSON string`;
  return {
    parsed: null,
    error: `GOOGLE_VISION_SA_KEY is not a valid service account key. Expected JSON or base64-encoded JSON. Got ${looks}.`,
    method: "failed",
    hint: "Store the full JSON content from your Google Cloud service account .json file, or base64-encode it (recommended to avoid escaping issues).",
  };
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

type StageStatus = Record<string, unknown>;

interface HttpStageResult {
  url: string;
  http_status: number;
  content_type: string;
  response_length: number;
  response_text_first_200: string;
  parse_attempted: boolean;
  parse_result: "ok" | "failed" | "skipped_non_json";
  parsed_data?: unknown;
}

function safeJsonParse(text: string, contentType: string): { parsed: unknown | null; parse_attempted: boolean; parse_result: "ok" | "failed" | "skipped_non_json" } {
  const shouldParse = contentType.includes("application/json") || text.trimStart().startsWith("{");
  if (!shouldParse) return { parsed: null, parse_attempted: false, parse_result: "skipped_non_json" };
  try {
    return { parsed: JSON.parse(text), parse_attempted: true, parse_result: "ok" };
  } catch {
    return { parsed: null, parse_attempted: true, parse_result: "failed" };
  }
}

async function fetchWithDiagnostics(url: string, options: RequestInit, signal: AbortSignal): Promise<HttpStageResult> {
  const res = await fetch(url, { ...options, signal });
  const contentType = res.headers.get("content-type") || "";
  const rawText = await res.text();
  const { parsed, parse_attempted, parse_result } = safeJsonParse(rawText, contentType);
  return {
    url,
    http_status: res.status,
    content_type: contentType,
    response_length: rawText.length,
    response_text_first_200: rawText.substring(0, 200),
    parse_attempted,
    parse_result,
    parsed_data: parsed,
  };
}

async function probeVision(_integration: typeof integrations[0]) {
  const stages: Record<string, StageStatus> = {};
  const totalStart = performance.now();

  // Stage 1: env var
  const saKey = Deno.env.get("GOOGLE_VISION_SA_KEY_V2") || Deno.env.get("GOOGLE_VISION_SA_KEY");
  if (!saKey) {
    return { success: false, failed_stage: "env_check", error: "GOOGLE_VISION_SA_KEY not configured", error_class: "bad_config", stages: { env_check: { status: "failed" } }, latency_ms: 0, resolved_model: "Cloud Vision API v1", gateway_headers: {} };
  }

  // Stage 2: SA key parse
  const { parsed: sa, error: parseError, method, hint } = safeParseSAKey(saKey);
  if (!sa) {
    stages.sa_key_parse = { status: "failed", detail: parseError, first_chars: saKey.substring(0, 20).replace(/[^ -~]/g, "?"), length: saKey.length, parse_method: method, ...(hint ? { hint } : {}) };
    return { success: false, failed_stage: "sa_key_parse", error: parseError || "Not valid JSON service account key", error_class: "bad_config", stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {} };
  }
  stages.sa_key_parse = { status: "ok", parse_method: method, client_email: sa.client_email ? "configured" : "missing" };

  // Stage 3: JWT sign
  let jwt: string;
  try {
    jwt = await createGoogleJWT(sa);
    stages.jwt_sign = { status: "ok" };
  } catch (e) {
    stages.jwt_sign = { status: "failed", detail: e instanceof Error ? e.message : "unknown" };
    return { success: false, failed_stage: "jwt_sign", error: "JWT signing failed", error_class: "auth_error", stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {} };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    // Stage 4: Token exchange
    const tokenStart = performance.now();
    let tokenDiag: HttpStageResult;
    try {
      tokenDiag = await fetchWithDiagnostics(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
        },
        controller.signal,
      );
    } catch (e) {
      const isTimeout = e instanceof DOMException && e.name === "AbortError";
      stages.token_exchange = { status: "failed", detail: e instanceof Error ? e.message : "unknown", error_class: isTimeout ? "timeout" : "network_error" };
      return { success: false, failed_stage: "token_exchange", error: "Token exchange network error", error_class: isTimeout ? "timeout" : "network_error", stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {} };
    }
    const tokenLatency = Math.round(performance.now() - tokenStart);

    if (tokenDiag.http_status !== 200 || tokenDiag.parse_result !== "ok") {
      stages.token_exchange = { status: "failed", latency_ms: tokenLatency, url: tokenDiag.url, http_status: tokenDiag.http_status, content_type: tokenDiag.content_type, response_length: tokenDiag.response_length, response_text_first_200: tokenDiag.response_text_first_200, parse_attempted: tokenDiag.parse_attempted, parse_result: tokenDiag.parse_result };
      const errClass = tokenDiag.parse_result !== "ok" ? "non_json_response" : classifyHttpStatus(tokenDiag.http_status);
      return { success: false, failed_stage: "token_exchange", error: `Token exchange HTTP ${tokenDiag.http_status}`, error_class: errClass, stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {} };
    }

    const tokenData = tokenDiag.parsed_data as Record<string, unknown>;
    if (!tokenData?.access_token) {
      stages.token_exchange = { status: "failed", latency_ms: tokenLatency, detail: "No access_token in response", http_status: 200 };
      return { success: false, failed_stage: "token_exchange", error: "No access_token in token response", error_class: "auth_error", stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {} };
    }
    stages.token_exchange = { status: "ok", latency_ms: tokenLatency, http_status: 200 };
    const accessToken = tokenData.access_token as string;

    // Stage 5: Vision API call
    const visionStart = performance.now();
    let visionDiag: HttpStageResult;
    try {
      visionDiag = await fetchWithDiagnostics(
        "https://vision.googleapis.com/v1/images:annotate",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ requests: [{ image: { content: TINY_PNG_B64 }, features: [{ type: "TEXT_DETECTION", maxResults: 1 }] }] }),
        },
        controller.signal,
      );
    } catch (e) {
      const isTimeout = e instanceof DOMException && e.name === "AbortError";
      stages.vision_call = { status: "failed", detail: e instanceof Error ? e.message : "unknown", error_class: isTimeout ? "timeout" : "network_error" };
      return { success: false, failed_stage: "vision_call", error: "Vision API network error", error_class: isTimeout ? "timeout" : "network_error", stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {} };
    }
    const visionLatency = Math.round(performance.now() - visionStart);

    if (visionDiag.http_status !== 200) {
      const errClass = classifyHttpStatus(visionDiag.http_status);
      stages.vision_call = { status: "failed", latency_ms: visionLatency, url: visionDiag.url, http_status: visionDiag.http_status, content_type: visionDiag.content_type, response_length: visionDiag.response_length, response_text_first_200: visionDiag.response_text_first_200, parse_attempted: visionDiag.parse_attempted, parse_result: visionDiag.parse_result };
      return { success: false, failed_stage: "vision_call", error: `Vision API HTTP ${visionDiag.http_status}`, error_class: errClass, stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {} };
    }

    if (visionDiag.parse_result !== "ok") {
      stages.vision_call = { status: "failed", latency_ms: visionLatency, http_status: 200, content_type: visionDiag.content_type, response_length: visionDiag.response_length, response_text_first_200: visionDiag.response_text_first_200, parse_attempted: visionDiag.parse_attempted, parse_result: visionDiag.parse_result };
      return { success: false, failed_stage: "vision_call", error: "Vision API returned non-JSON", error_class: "non_json_response", stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {} };
    }

    const visionData = visionDiag.parsed_data as Record<string, unknown>;
    if (Array.isArray(visionData?.responses)) {
      stages.vision_call = { status: "ok", latency_ms: visionLatency, http_status: 200, response_count: (visionData.responses as unknown[]).length };
      return { success: true, failed_stage: null, stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {}, error: null };
    }

    stages.vision_call = { status: "failed", latency_ms: visionLatency, http_status: 200, detail: "Missing 'responses' array", response_text_first_200: visionDiag.response_text_first_200 };
    return { success: false, failed_stage: "vision_call", error: "Missing 'responses' array in Vision response", error_class: "bad_request", stages, latency_ms: Math.round(performance.now() - totalStart), resolved_model: "Cloud Vision API v1", gateway_headers: {} };
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  const url = new URL(req.url);
  const verify = url.searchParams.get("verify") === "true";

  // Safety guard — strict mode in verify to catch preview/unpinned models
  const failures = validateIntegrations(verify);
  if (failures.length > 0) {
    return new Response(JSON.stringify({
      error: verify ? "PRODUCTION_STABILITY_CHECK_FAILED" : "STATIC_PLACEHOLDER_DETECTED",
      details: failures,
    }), { status: 500, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
  }

  const manifest = buildManifest();
  const summary = buildSummary();

  if (!verify) {
    return new Response(JSON.stringify({
      integrations: manifest,
      summary,
      validated: true,
      timestamp: new Date().toISOString(),
    }), { headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
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
  }), { headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
});
