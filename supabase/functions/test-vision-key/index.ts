import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const raw = Deno.env.get("GOOGLE_VISION_SA_KEY") || "";
  const cleaned = raw.replace(/^\uFEFF/, '').trim();
  
  // Try all parse methods
  const results: Record<string, any> = {
    rawLength: raw.length,
    cleanedLength: cleaned.length,
    first80: cleaned.substring(0, 80),
    last40: cleaned.substring(Math.max(0, cleaned.length - 40)),
    startsWithBrace: cleaned.startsWith("{"),
    containsPrivateKey: cleaned.includes("private_key"),
    containsClientEmail: cleaned.includes("client_email"),
    containsBeginPrivate: cleaned.includes("BEGIN PRIVATE KEY"),
  };

  // Try direct parse
  try {
    const obj = JSON.parse(cleaned);
    results.directParse = "SUCCESS";
    results.hasClientEmail = !!obj.client_email;
    results.hasPrivateKey = !!obj.private_key;
    results.privateKeyLength = obj.private_key?.length || 0;
    results.clientEmail = obj.client_email;
  } catch (e) {
    results.directParse = `FAIL: ${(e as Error).message}`;
  }

  // Try unescape parse
  try {
    const obj = JSON.parse(cleaned.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    results.unescapeParse = "SUCCESS";
  } catch {
    results.unescapeParse = "FAIL";
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
