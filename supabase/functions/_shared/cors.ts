/**
 * Shared CORS helper for Supabase Edge Functions.
 *
 * Usage in each function:
 *
 *   import { corsHeaders } from "../_shared/cors.ts";
 *
 *   Deno.serve(async (req) => {
 *     if (req.method === "OPTIONS") {
 *       return new Response(null, { headers: corsHeaders(req) });
 *     }
 *     const cors = corsHeaders(req);
 *     // ... use { headers: { ...cors, "Content-Type": "application/json" } }
 *   });
 *
 * Origin restriction:
 *   - Set the `ALLOWED_ORIGIN` Supabase secret to your production URL
 *     (e.g. `https://your-app.lovable.app`) to restrict cross-origin access.
 *   - When unset the function behaves as before (Access-Control-Allow-Origin: *),
 *     which is safe for Supabase-hosted projects behind Supabase Auth.
 */

const ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, " +
  "x-supabase-client-platform, x-supabase-client-platform-version, " +
  "x-supabase-client-runtime, x-supabase-client-runtime-version";

/**
 * Returns CORS headers for the given request.
 *
 * When the `ALLOWED_ORIGIN` environment variable is set, the function
 * reflects the request Origin only if it matches — otherwise it returns
 * an empty string (the browser will block the response).
 * When `ALLOWED_ORIGIN` is not set it falls back to `*`.
 */
export function corsHeaders(req?: Request): Record<string, string> {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");

  let origin: string;
  if (allowedOrigin) {
    const requestOrigin = req?.headers.get("Origin") ?? "";
    origin = requestOrigin === allowedOrigin ? requestOrigin : "";
  } else {
    origin = "*";
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
  };
}
