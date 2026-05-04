// Thin-router edge function template.
// Rules:
//  - Keep payloads <500KB. Push large data to Storage and pass signed URLs.
//  - Stay under 150MB RAM. Stream where possible.
//  - Max 3 vision images per AI call. Batch larger sets in the client.
//  - Always handle CORS preflight.
//  - Return JSON; never HTML/text errors.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "./cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "missing auth" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    // ── PROJECT-SPECIFIC: do work here ────────────────────────────────────
    const result = { ok: true, echo: body, userId: user.id };
    return json(result);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}