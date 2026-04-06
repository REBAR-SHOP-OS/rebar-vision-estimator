import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildShopDrawingHtml } from "../../../src/lib/shop-drawing-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      barList,
      elements,
      projectName,
      clientName,
      standard,
      coatingType,
      sizeBreakdown,
      options,
      logoDataUri,
      estimateContext,
    } = await req.json();

    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    // Merge options with defaults
    const opts = {
      scale: "1:50",
      includeDims: true,
      layerGrouping: true,
      barMarks: true,
      drawingPrefix: "SD-",
      notes: "",
      estimateFileName: "",
      ...options,
    };

    const html = buildShopDrawingHtml({
      barList,
      elements,
      projectName,
      clientName,
      standard,
      coatingType,
      sizeBreakdown,
      options: opts,
      dateStr,
      logoDataUri,
      estimateContext: typeof estimateContext === "string" ? estimateContext : "",
    });

    console.log(JSON.stringify({
      route: "generate-shop-drawing",
      provider: "deterministic-template",
      gateway: "local",
      pinned_model: null,
      bar_count: Array.isArray(barList) ? barList.length : 0,
      sheet_mode: "multi-page",
      success: Boolean(html),
    }));

    return new Response(JSON.stringify({ html }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-shop-drawing error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
