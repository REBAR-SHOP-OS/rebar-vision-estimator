import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, userId } = await req.json();

    if (!userId || !messages || messages.length < 3) {
      return new Response(JSON.stringify({ skipped: true, reason: "Not enough messages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Ask AI to extract key learnings
    const extractPrompt = `You are an expert at extracting useful knowledge from construction estimation conversations.

Analyze the following conversation between a user and an AI rebar estimator. Extract 1-3 concise, actionable learnings that would help the AI perform better in future projects.

Focus on:
- User corrections to AI estimates (methodology, calculation approach)
- General patterns or preferences (NOT project-specific values)
- Calculation methodology improvements
- Common mistakes to avoid

CRITICAL SANITIZATION RULES:
- Do NOT include any project-specific sheet numbers (e.g. "S-2", "S-5", "page 3")
- Do NOT include any project-specific dimensions, lengths, or quantities (e.g. "74m", "2500mm", "8 columns")
- Do NOT include any project names, addresses, or client names
- Do NOT include any element IDs specific to a project (e.g. "F1", "W3", "C2")
- ONLY extract generalizable METHODOLOGY insights that apply across ALL projects
- Good example: "Always check for lap splice notes in general notes section"
- Bad example: "The retaining wall on S-2 is 74m long with 300mm stem"

Format each learning as a single clear sentence. If no useful learning can be extracted, respond with "NONE".

Conversation:
${messages.map((m: any) => `${m.role}: ${m.content?.substring(0, 500)}`).join("\n\n")}`;

    const aiStart = performance.now();
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "Extract concise learnings from conversations. Be brief and actionable." },
          { role: "user", content: extractPrompt },
        ],
        temperature: 0,
        top_p: 1,
        max_tokens: 1024,
      }),
    });

    const aiLatency = Math.round(performance.now() - aiStart);
    console.log(JSON.stringify({ route: "extract-learning", provider: "google/gemini", gateway: "lovable-ai", pinned_model: "google/gemini-2.5-flash-lite", latency_ms: aiLatency, success: aiResponse.ok, fallback_used: false }));

    if (!aiResponse.ok) {
      console.error("AI extraction failed:", aiResponse.status);
      return new Response(JSON.stringify({ error: "AI extraction failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const learningText = aiData.choices?.[0]?.message?.content?.trim();

    if (!learningText || learningText === "NONE") {
      return new Response(JSON.stringify({ skipped: true, reason: "No useful learning" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check existing learned items count
    const { data: existing } = await supabaseAdmin
      .from("agent_knowledge")
      .select("id, created_at")
      .eq("user_id", userId)
      .eq("type", "learned")
      .order("created_at", { ascending: true });

    // If at limit, delete oldest
    if (existing && existing.length >= 50) {
      const toDelete = existing.slice(0, existing.length - 49);
      for (const item of toDelete) {
        await supabaseAdmin.from("agent_knowledge").delete().eq("id", item.id);
      }
    }

    // Save new learning
    const { error } = await supabaseAdmin.from("agent_knowledge").insert({
      user_id: userId,
      title: "Auto-learned",
      content: learningText,
      type: "learned",
    });

    if (error) {
      console.error("Failed to save learning:", error);
      return new Response(JSON.stringify({ error: "Failed to save" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-learning error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
