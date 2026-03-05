import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const providers = [
  {
    provider: "google/gemini",
    model: "google/gemini-2.5-pro",
    gateway: "Lovable AI Gateway",
    function: "analyze-blueprint",
    usage: "PDF parsing, rebar estimation, structural reasoning (streaming)",
  },
  {
    provider: "google-cloud-vision",
    model: "Cloud Vision API v1",
    gateway: "Direct (Service Account)",
    function: "analyze-blueprint",
    usage: "OCR for scanned/raster PDF pages",
  },
  {
    provider: "google/gemini",
    model: "google/gemini-2.5-flash",
    gateway: "Lovable AI Gateway",
    function: "detect-project-type",
    usage: "Project type classification from blueprint pages",
  },
  {
    provider: "google-cloud-vision",
    model: "Cloud Vision API v1",
    gateway: "Direct (Service Account)",
    function: "detect-project-type",
    usage: "OCR for blueprint page thumbnails",
  },
  {
    provider: "google/gemini",
    model: "google/gemini-3-flash-preview",
    gateway: "Lovable AI Gateway",
    function: "generate-shop-drawing",
    usage: "Shop drawing HTML generation from bar list data",
  },
  {
    provider: "google/gemini",
    model: "google/gemini-2.5-flash-lite",
    gateway: "Lovable AI Gateway",
    function: "extract-learning",
    usage: "Conversation learning extraction for agent knowledge",
  },
  {
    provider: "google/gemini",
    model: "google/gemini-2.5-flash",
    gateway: "Lovable AI Gateway",
    function: "analyze-outcomes",
    usage: "Estimation accuracy analysis, correction rule generation",
  },
];

const uniqueModels = [...new Set(providers.map((p) => p.model))];
const uniqueGateways = [...new Set(providers.map((p) => p.gateway))];
const uniqueProviders = [...new Set(providers.map((p) => p.provider))];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      providers,
      summary: {
        total_providers: uniqueProviders.length,
        total_models: uniqueModels.length,
        total_integrations: providers.length,
        gateways: uniqueGateways,
        models: uniqueModels,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
