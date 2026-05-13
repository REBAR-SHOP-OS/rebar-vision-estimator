const DEFAULT_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";
const DEFAULT_ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

function resolveAllowedOrigin(req: Request): string {
  const configuredOrigin = Deno.env.get("ALLOWED_ORIGIN")?.trim();
  const requestOrigin = req.headers.get("origin")?.trim();

  if (!configuredOrigin) return requestOrigin || "*";
  if (!requestOrigin) return configuredOrigin;
  return requestOrigin === configuredOrigin ? requestOrigin : configuredOrigin;
}

export function createCorsHeaders(req: Request, extraHeaders: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": resolveAllowedOrigin(req),
    "Access-Control-Allow-Headers": DEFAULT_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": DEFAULT_ALLOW_METHODS,
    ...extraHeaders,
  };
}

export function createJsonHeaders(req: Request, extraHeaders: Record<string, string> = {}) {
  return createCorsHeaders(req, {
    "Content-Type": "application/json",
    ...extraHeaders,
  });
}
