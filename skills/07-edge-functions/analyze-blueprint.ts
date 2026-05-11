// Reference implementation — extract structured data from blueprint pages.
// Pattern:
//   1. Receive { signedPageUrls: string[] } from the client (max 3 per call).
//   2. Build a vision prompt with the Atomic Truth envelope contract.
//   3. Call AI gateway (model: google/gemini-2.5-pro for vision quality).
//   4. Parse JSON, fail-closed at element level, return.
// See: skills/04-ai-gateway/prompts/atomic-truth.md
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "./_template/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({ todo: "wire to your AI gateway vision call" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});