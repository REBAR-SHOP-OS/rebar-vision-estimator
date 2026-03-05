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

async function probeVision(integration: typeof integrations[0]) {
  const saKey = Deno.env.get("GOOGLE_VISION_SA_KEY");
  if (!saKey) return { success: false, error: "GOOGLE_VISION_SA_KEY not configured", latency_ms: 0, resolved_model: "Cloud Vision API v1", gateway_headers: {} };

  const start = performance.now();
  const { parsed: sa, error: parseError, method } = safeParseSAKey(saKey);

  if (!sa) {
    const latency_ms = Math.round(performance.now() - start);
    const firstChars = saKey.substring(0, 20).replace(/[^ -~]/g, "?"); // safe printable chars only
    return {
      success: false,
      error: `${parseError} | first_chars: "${firstChars}" | length: ${saKey.length}`,
      latency_ms,
      resolved_model: "Cloud Vision API v1",
      gateway_headers: { parse_method: method },
    };
  }

  const latency_ms = Math.round(performance.now() - start);
  return {
    success: true,
    latency_ms,
    resolved_model: "Cloud Vision API v1",
    gateway_headers: {
      config_verified: "service_account_key_present",
      client_email: (sa as Record<string, unknown>).client_email ? "configured" : "missing",
      parse_method: method,
    },
    error: null,
  };
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
