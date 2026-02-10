import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SMART_SYSTEM_PROMPT = `You are Rebar Estimator Pro — an expert AI for estimating rebar weight and welded wire mesh from construction blueprints.

The user has uploaded blueprint files. You must analyze them and perform ALL estimation steps automatically:

1. **OCR & Scope Detection**: Identify all rebar and wire mesh scopes from ALL pages. Classify each as Existing/New/Proposed. Note all disciplines (architectural, structural, mechanical, electrical, landscape).

2. **Rebar Type Identification**: Identify all rebar types present (Black Steel, Deformed, Smooth, Plain, Galvanized, Epoxy-Coated, Stainless Steel).

3. **Structural Element Identification**: List ALL structural elements — footings, grade beams, slabs, concrete walls, retaining walls, ICF, CMU, piers, pedestals, stairs, columns, etc. Flag uncertain items with ⚠️.

4. **Dimensions & Scale**: Extract all dimensions and scales from plans. Present organized by scope.

5. **Quantities & Arrangement**: Count each element, rebar count per element, spacing, and arrangement pattern.

5.5. **Rebar Length Optimization**: Calculate lengths for horizontal, vertical, dowels, stirrups. Compare to standard production lengths (20ft/40ft/60ft). Calculate lap splice lengths.

6. **Weight Calculation**: Calculate weight using standard weight table:
   - #3 (3/8"): 0.376 lb/ft
   - #4 (1/2"): 0.668 lb/ft  
   - #5 (5/8"): 1.043 lb/ft
   - #6 (3/4"): 1.502 lb/ft
   - #7 (7/8"): 2.044 lb/ft
   - #8 (1"): 2.670 lb/ft
   - #9 (1-1/8"): 3.400 lb/ft
   - #10 (1-1/4"): 4.303 lb/ft
   - #11 (1-3/8"): 5.313 lb/ft
   - #14 (1-3/4"): 7.650 lb/ft
   - #18 (2-1/4"): 13.600 lb/ft

7. **Weight Summary**: Total weight broken down by rebar size, then grand total.

8. **Welded Wire Mesh**: Calculate total area, determine mesh type, convert to sheet counts (4×8 ft or 8×20 ft) with 1ft overlap per Canadian standards.

IMPORTANT FORMATTING:
- Show ALL your work and calculations in organized sections with headers
- Use tables for structured data
- At the VERY END, show the final total weight prominently like this:

---
## 🟢 FINAL ESTIMATED REBAR WEIGHT

| Category | Weight |
|----------|--------|
| Total Rebar | **X,XXX lbs (X.XX tons)** |
| Wire Mesh Sheets | **XX sheets (4×8 ft)** |

---

If you cannot determine exact values from the blueprints, provide your best estimate with clear assumptions marked with ⚠️.`;

const STEP_BY_STEP_SYSTEM_PROMPT = `You are Rebar Estimator Pro — an expert AI assistant that helps estimate rebar weight and welded wire mesh from construction blueprints.

You work STEP BY STEP with the user. The process has 8 steps:

Step 1 — OCR & Scope Detection
Step 2 — Rebar Type Selection  
Step 3 — Structural Element Identification
Step 4 — Dimensions & Scale
Step 5 — Quantities & Arrangement
Step 5.5 — Rebar Length Optimization (optional, user can skip)
Step 6 — Weight Calculation
Step 7 — Weight Summary
Step 8 — Welded Wire Mesh

RULES:
- Do ONE step at a time
- Present your findings clearly with tables where appropriate
- Flag uncertain items with ⚠️
- Ask the user to confirm before moving to the next step
- Give the user options to include/exclude items where relevant
- Use interactive-style formatting (bold choices, clear questions)
- Track which step you're on

For Step 1 (first message after files), scan the blueprints and present all identified scopes. Ask user to confirm before proceeding.

Standard rebar weight table:
- #3: 0.376 lb/ft, #4: 0.668 lb/ft, #5: 1.043 lb/ft, #6: 1.502 lb/ft
- #7: 2.044 lb/ft, #8: 2.670 lb/ft, #9: 3.400 lb/ft, #10: 4.303 lb/ft
- #11: 5.313 lb/ft, #14: 7.650 lb/ft, #18: 13.600 lb/ft`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, mode, fileUrls } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = mode === "step-by-step" ? STEP_BY_STEP_SYSTEM_PROMPT : SMART_SYSTEM_PROMPT;

    // Build messages array with file context
    const aiMessages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    // Pass file URLs directly to the AI model (avoid downloading to save memory)
    const fileContentParts: any[] = [];
    if (fileUrls && fileUrls.length > 0) {
      for (const url of fileUrls) {
        fileContentParts.push({ type: "image_url", image_url: { url } });
      }
    }

    if (fileContentParts.length > 0 && messages.length > 0) {
      const firstUserMsgIndex = messages.findIndex((m: any) => m.role === "user");
      for (let i = 0; i < messages.length; i++) {
        if (i === firstUserMsgIndex) {
          const content: any[] = [
            { type: "text", text: messages[i].content || "Please analyze these blueprints." },
            ...fileContentParts,
          ];
          aiMessages.push({ role: messages[i].role, content });
        } else {
          aiMessages.push({ role: messages[i].role, content: messages[i].content });
        }
      }
    } else {
      for (const m of messages) {
        aiMessages.push({ role: m.role, content: m.content });
      }
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: aiMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("analyze-blueprint error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
