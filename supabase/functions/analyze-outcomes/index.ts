import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Require authenticated caller; derive user_id from JWT (ignore body)
    const authHeader = req.headers.get("Authorization");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user } } = await anonClient.auth.getUser(authHeader?.replace("Bearer ", "") ?? "");
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user_id = user.id;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all outcomes for this user
    const { data: outcomes, error: outErr } = await supabase
      .from("estimate_outcomes")
      .select("*, projects(name, project_type, client_name)")
      .eq("user_id", user_id);

    if (outErr) throw new Error(`Failed to fetch outcomes: ${outErr.message}`);
    if (!outcomes || outcomes.length === 0) {
      return new Response(JSON.stringify({
        analysis: "No outcome data available yet. Complete some projects and record actual costs to enable delta analysis.",
        rules: [],
        stats: { total_outcomes: 0 },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Compute basic statistics
    const withActuals = outcomes.filter((o: any) => o.actual_cost != null && o.quoted_price != null);
    const deltas = withActuals.map((o: any) => ({
      project_name: o.projects?.name || "Unknown",
      project_type: o.projects?.project_type || "unknown",
      client: o.projects?.client_name || "Unknown",
      quoted: Number(o.quoted_price),
      actual: Number(o.actual_cost),
      delta: Number(o.actual_cost) - Number(o.quoted_price),
      delta_pct: ((Number(o.actual_cost) - Number(o.quoted_price)) / Number(o.quoted_price) * 100),
      weight_quoted: o.quoted_weight_kg ? Number(o.quoted_weight_kg) : null,
      weight_actual: o.actual_weight_kg ? Number(o.actual_weight_kg) : null,
      change_orders: o.change_orders_total ? Number(o.change_orders_total) : 0,
      award_status: o.award_status,
    }));

    const avgDelta = deltas.length > 0 ? deltas.reduce((s: number, d: any) => s + d.delta_pct, 0) / deltas.length : 0;
    const bias = avgDelta > 2 ? "under-estimating" : avgDelta < -2 ? "over-estimating" : "well-calibrated";

    // Group by project type
    const byType: Record<string, any[]> = {};
    for (const d of deltas) {
      if (!byType[d.project_type]) byType[d.project_type] = [];
      byType[d.project_type].push(d);
    }

    const typeStats = Object.entries(byType).map(([type, items]) => ({
      type,
      count: items.length,
      avg_delta_pct: items.reduce((s, d) => s + d.delta_pct, 0) / items.length,
      avg_change_orders: items.reduce((s, d) => s + d.change_orders, 0) / items.length,
    }));

    // Use Lovable AI to generate learned rules
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    let aiRules: any[] = [];
    let aiAnalysis = "";

    if (LOVABLE_API_KEY && deltas.length >= 3) {
      const prompt = `You are a rebar estimating expert analyzing historical estimation accuracy data.

Here are ${deltas.length} completed projects with quoted vs actual costs:

${JSON.stringify(deltas, null, 2)}

Statistics:
- Average delta: ${avgDelta.toFixed(1)}% (${bias})
- By project type: ${JSON.stringify(typeStats)}

Based on this data, provide:
1. A brief analysis of estimation patterns and biases (2-3 paragraphs)
2. 3-5 specific correction rules that should be applied to future estimates

Format your response as JSON:
{
  "analysis": "your analysis text",
  "rules": [
    {
      "rule_id": "rule_001",
      "condition": "when condition applies",
      "correction": "what to adjust",
      "confidence": 0.85,
      "based_on": "N projects showing pattern"
    }
  ]
}`;

      try {
        const aiStart = performance.now();
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "You are a construction estimation expert specializing in rebar takeoff accuracy analysis. Return only valid JSON." },
              { role: "user", content: prompt },
            ],
            temperature: 0,
            top_p: 1,
            max_tokens: 4096,
            tools: [{
              type: "function",
              function: {
                name: "provide_analysis",
                description: "Provide estimation accuracy analysis and correction rules",
                parameters: {
                  type: "object",
                  properties: {
                    analysis: { type: "string", description: "Analysis text" },
                    rules: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          rule_id: { type: "string" },
                          condition: { type: "string" },
                          correction: { type: "string" },
                          confidence: { type: "number" },
                          based_on: { type: "string" },
                        },
                        required: ["rule_id", "condition", "correction", "confidence", "based_on"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["analysis", "rules"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "provide_analysis" } },
          }),
        });

        const aiLatency = Math.round(performance.now() - aiStart);
        console.log(JSON.stringify({ route: "analyze-outcomes", provider: "google/gemini", gateway: "lovable-ai", pinned_model: "google/gemini-2.5-flash", latency_ms: aiLatency, success: aiRes.ok, fallback_used: false }));

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const parsed = JSON.parse(toolCall.function.arguments);
            aiRules = parsed.rules || [];
            aiAnalysis = parsed.analysis || "";
          }
        } else if (aiRes.status === 429) {
          aiAnalysis = "Rate limited — try again later.";
        } else if (aiRes.status === 402) {
          aiAnalysis = "AI credits exhausted — please add funds.";
        }
      } catch (aiErr) {
        console.error("AI analysis error:", aiErr);
        aiAnalysis = "AI analysis unavailable.";
      }
    }

    // Store learned rules in agent_knowledge
    if (aiRules.length > 0) {
      for (const rule of aiRules) {
        await supabase.from("agent_knowledge").insert({
          user_id,
          type: "learned_rule",
          title: `Delta Rule: ${rule.rule_id}`,
          content: JSON.stringify(rule),
        });
      }
    }

    return new Response(JSON.stringify({
      analysis: aiAnalysis || `${deltas.length} outcomes analyzed. Bias: ${bias} (${avgDelta.toFixed(1)}% average delta).`,
      rules: aiRules,
      stats: {
        total_outcomes: outcomes.length,
        with_actuals: withActuals.length,
        avg_delta_pct: avgDelta,
        bias,
        by_project_type: typeStats,
        won: outcomes.filter((o: any) => o.award_status === "won").length,
        lost: outcomes.filter((o: any) => o.award_status === "lost").length,
        pending: outcomes.filter((o: any) => o.award_status === "pending").length,
      },
      deltas,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("analyze-outcomes error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
