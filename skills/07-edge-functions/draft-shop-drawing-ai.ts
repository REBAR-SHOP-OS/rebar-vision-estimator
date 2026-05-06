// Reference implementation — generate an AI candidate sketch via image model.
// Strip the domain wording; keep the safety constraints (no title-block fields,
// dashed orange callouts, "Candidate #N" labels).
// Wire the result through skills/06-shop-drawing-engine/sheet-templates/ai-candidate.html.ts
// then render to PDF with Puppeteer/Chromium at the chosen sheet size.
//
// See full prompt skeleton: skills/04-ai-gateway/prompts/shop-drawing-ai.md
// See model rules:           skills/04-ai-gateway/model-config.md
//
// PROJECT-SPECIFIC: replace `buildPrompt(...)` with your domain wording.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "./_template/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // implementation: see prompts/shop-drawing-ai.md for the prompt template.
  return new Response(JSON.stringify({ todo: "wire to your AI gateway call" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});