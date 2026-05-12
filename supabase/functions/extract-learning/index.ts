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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Require authenticated caller; derive userId from JWT
    const authHeader = req.headers.get("Authorization");
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user } } = await anonClient.auth.getUser(authHeader?.replace("Bearer ", "") ?? "");
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const { messages, manualInsight } = await req.json();

    // manualInsight bypasses extraction — goes straight to dedup
    const hasManual = typeof manualInsight === "string" && manualInsight.trim().length > 0;

    if (!hasManual && (!messages || messages.length < 3)) {
      return new Response(JSON.stringify({ skipped: true, reason: "Not enough data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let learningText: string;

    if (hasManual) {
      learningText = manualInsight!.trim();
    } else {
      // Step 1: Extract learnings from conversation
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

When the user explicitly corrects the AI, use strong absolute language:
- Use "ALWAYS" or "NEVER" for critical corrections
- Example: "NEVER assume default lap lengths without checking general notes first"

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
      console.log(JSON.stringify({ route: "extract-learning", step: "extract", latency_ms: aiLatency, success: aiResponse.ok }));

      if (!aiResponse.ok) {
        console.error("AI extraction failed:", aiResponse.status);
        return new Response(JSON.stringify({ error: "AI extraction failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiResponse.json();
      learningText = aiData.choices?.[0]?.message?.content?.trim() || "";

      if (!learningText || learningText === "NONE") {
        return new Response(JSON.stringify({ skipped: true, reason: "No useful learning" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Step 2: Fetch existing learned rules for dedup
    const { data: existingRules } = await supabaseAdmin
      .from("agent_knowledge")
      .select("id, content")
      .eq("user_id", userId)
      .eq("type", "learned");

    // Step 3: Smart dedup/merge via AI
    const dedupPrompt = `You have EXISTING learned rules and NEW learnings. For each new learning, decide what to do.

EXISTING RULES:
${existingRules?.map((r) => `[ID:${r.id}] ${r.content}`).join("\n") || "None"}

NEW LEARNINGS:
${learningText}

For each new learning, respond with ONLY a JSON array:
[{ "action": "skip|merge|insert", "target_id": "uuid (only for merge)", "content": "final text (for merge/insert)", "reason": "brief explanation" }]

Rules:
- "skip" if semantically identical to an existing rule (even with different wording/naming)
- "merge" if it refines, extends, or strengthens an existing rule — combine BOTH into ONE stronger statement. Use the existing rule's ID as target_id.
- "insert" only if truly novel and not covered by any existing rule
- When merging, preserve ALL insights from both old and new
- For critical user corrections, use ALWAYS/NEVER language
- Strip any project-specific data (sheet numbers, dimensions, project names)
- Respond with ONLY the JSON array, nothing else`;

    const dedupStart = performance.now();
    const dedupResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a deduplication engine. Respond ONLY with a valid JSON array." },
          { role: "user", content: dedupPrompt },
        ],
        temperature: 0,
        top_p: 1,
        max_tokens: 2048,
      }),
    });

    const dedupLatency = Math.round(performance.now() - dedupStart);
    console.log(JSON.stringify({ route: "extract-learning", step: "dedup", latency_ms: dedupLatency, success: dedupResponse.ok }));

    if (!dedupResponse.ok) {
      // Fallback: insert as before if dedup fails
      console.error("Dedup AI failed, falling back to direct insert");
      await supabaseAdmin.from("agent_knowledge").insert({
        user_id: userId,
        title: "Auto-learned (methodology only)",
        content: `[Methodology only]: ${learningText}`,
        type: "learned",
      });
      return new Response(JSON.stringify({ success: true, fallback: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dedupData = await dedupResponse.json();
    let rawContent = dedupData.choices?.[0]?.message?.content?.trim() || "[]";
    // Strip markdown code fences if present
    rawContent = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

    let actions: any[];
    try {
      actions = JSON.parse(rawContent);
    } catch {
      console.error("Failed to parse dedup response:", rawContent);
      // Fallback: insert directly
      await supabaseAdmin.from("agent_knowledge").insert({
        user_id: userId,
        title: "Auto-learned (methodology only)",
        content: `[Methodology only]: ${learningText}`,
        type: "learned",
      });
      return new Response(JSON.stringify({ success: true, fallback: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 4: Execute actions
    let inserted = 0, merged = 0, skipped = 0;

    for (const action of actions) {
      if (action.action === "skip") {
        skipped++;
      } else if (action.action === "merge" && action.target_id && action.content) {
        await supabaseAdmin
          .from("agent_knowledge")
          .update({ content: `[Methodology only]: ${action.content}` })
          .eq("id", action.target_id)
          .eq("user_id", userId);
        merged++;
      } else if (action.action === "insert" && action.content) {
        // Safety cap: check count before inserting
        const currentCount = existingRules?.length || 0;
        if (currentCount + inserted >= 50) {
          // Delete oldest to make room
          const { data: oldest } = await supabaseAdmin
            .from("agent_knowledge")
            .select("id")
            .eq("user_id", userId)
            .eq("type", "learned")
            .order("created_at", { ascending: true })
            .limit(1);
          if (oldest?.[0]) {
            await supabaseAdmin.from("agent_knowledge").delete().eq("id", oldest[0].id);
          }
        }
        await supabaseAdmin.from("agent_knowledge").insert({
          user_id: userId,
          title: "Auto-learned (methodology only)",
          content: `[Methodology only]: ${action.content}`,
          type: "learned",
        });
        inserted++;
      }
    }

    console.log(JSON.stringify({ route: "extract-learning", inserted, merged, skipped }));

    return new Response(JSON.stringify({ success: true, inserted, merged, skipped }), {
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
