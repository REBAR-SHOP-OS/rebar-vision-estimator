import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-pro";

const PROMPT = `You are a structural-drawing schedule extractor. From the attached drawing page image(s), find any FOOTING SCHEDULE, PIER SCHEDULE, COLUMN SCHEDULE, or REINFORCEMENT SCHEDULE tables and transcribe them VERBATIM. Do not infer or interpolate values that are not printed. If a value is illegible, return null and add it to "illegible".

Return JSON only:
{
  "schedules": [
    {
      "schedule_type": "footing|pier|column|reinforcement|other",
      "page": <int>,
      "rows": [
        { "mark": "F-1", "size_mm": "650x650", "depth_mm": 300, "bottom_mat": "5-15M EW", "top_mat": null, "ties": null, "notes": null }
      ],
      "illegible": ["<short description of any unread cell>"]
    }
  ],
  "no_schedule_found": <bool>
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;

    const supabase = createClient(SUPABASE_URL, SR);
    const anonClient = createClient(SUPABASE_URL, ANON);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const project_id: string | undefined = body.project_id;
    const storage_paths: string[] = Array.isArray(body.storage_paths) ? body.storage_paths.slice(0, 3) : [];
    if (!project_id || storage_paths.length === 0) {
      return new Response(JSON.stringify({ error: "project_id and storage_paths[] required (max 3)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sign URLs (1h)
    const imageUrls: string[] = [];
    for (const p of storage_paths) {
      const { data: signed, error: sErr } = await supabase.storage.from("blueprints").createSignedUrl(p, 3600);
      if (sErr || !signed?.signedUrl) {
        return new Response(JSON.stringify({ error: `sign failed for ${p}: ${sErr?.message}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      imageUrls.push(signed.signedUrl);
    }

    const userContent: any[] = [{ type: "text", text: PROMPT }];
    for (const url of imageUrls) userContent.push({ type: "image_url", image_url: { url } });

    const aiRes = await fetch(LOVABLE_API, {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You transcribe construction-drawing schedules verbatim. JSON only. Never invent values." },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return new Response(JSON.stringify({ error: `AI gateway ${aiRes.status}`, detail: txt.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = { parse_error: content.slice(0, 500) }; }

    // Audit
    await supabase.from("audit_events").insert({
      user_id: user.id,
      project_id,
      entity_type: "project",
      entity_id: project_id,
      action: "schedule_vision_extracted",
      metadata: { storage_paths, schedules_count: parsed?.schedules?.length ?? 0 },
    });

    return new Response(JSON.stringify({ status: "ok", result: parsed }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});