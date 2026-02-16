import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Rebar weight per foot (lb/ft) — LOCKED
const REBAR_WEIGHT: Record<string, number> = {
  "#3": 0.376,
  "#4": 0.668,
  "#5": 1.043,
  "#6": 1.502,
  "#7": 2.044,
  "#8": 2.670,
  "#9": 3.400,
  "#10": 4.303,
  "#11": 5.313,
  "#14": 7.650,
  "#18": 13.600,
};

interface ElementTruth {
  element_id: string;
  element_type: string;
  truth: {
    vertical_bars?: { size: string; qty: number };
    ties?: { size: string; spacing_mm: number };
    laps?: Record<string, any>;
    grade?: string;
    coating?: string;
    [key: string]: any;
  };
  sources: {
    identity_sources: string[];
    [key: string]: any;
  };
  confidence: number;
  status: "READY" | "FLAGGED" | "BLOCKED";
}

function calculateElementWeight(truth: ElementTruth["truth"], elementType: string): {
  weight_lbs: number;
  breakdown: Record<string, number>;
} {
  const breakdown: Record<string, number> = {};
  let totalWeight = 0;

  const SLAB_TYPES = ["SLAB", "RAFT_SLAB", "SLAB_STRIP"];

  if (SLAB_TYPES.includes(elementType) && truth.area_sqft && truth.mesh_type) {
    // Area-based calculation for slabs with mesh
    const meshWeightPerSqft = 0.85; // approximate for standard WWF
    const weight = truth.area_sqft * meshWeightPerSqft;
    breakdown[`mesh_${truth.mesh_type || "standard"}`] = weight;
    totalWeight += weight;
  }

  if (elementType === "WIRE_MESH" && truth.area_sqft) {
    const meshWeightPerSqft = 0.85;
    const weight = truth.area_sqft * meshWeightPerSqft;
    breakdown["wire_mesh"] = weight;
    totalWeight += weight;
  }

  // Vertical bars weight estimation
  if (truth.vertical_bars?.size && truth.vertical_bars?.qty) {
    const size = truth.vertical_bars.size;
    const qty = truth.vertical_bars.qty;
    const weightPerFt = REBAR_WEIGHT[size] || 0;
    // Default lengths by type
    const lengthDefaults: Record<string, number> = {
      COLUMN: 12, WALL: 12, FOOTING: 6, BEAM: 20, GRADE_BEAM: 20,
      RETAINING_WALL: 12, ICF_WALL: 10, CMU_WALL: 10, PIER: 10,
      STAIR: 8, SLAB: 10, RAFT_SLAB: 10, SLAB_STRIP: 20,
    };
    const defaultLengthFt = lengthDefaults[elementType] || 12;
    const weight = weightPerFt * defaultLengthFt * qty;
    breakdown[`vertical_${size}`] = weight;
    totalWeight += weight;
  }

  // Ties weight estimation
  if (truth.ties?.size && truth.ties?.spacing_mm) {
    const size = truth.ties.size;
    const weightPerFt = REBAR_WEIGHT[size] || 0;
    const tiePerimeterDefaults: Record<string, number> = {
      COLUMN: 4, WALL: 6, FOOTING: 5, BEAM: 4, GRADE_BEAM: 4,
      RETAINING_WALL: 6, ICF_WALL: 3, CMU_WALL: 3, PIER: 3,
    };
    const tiePerimeterFt = tiePerimeterDefaults[elementType] || 4;
    const lengthDefaults: Record<string, number> = {
      COLUMN: 3660, WALL: 3660, FOOTING: 1830, BEAM: 6100, GRADE_BEAM: 6100,
      RETAINING_WALL: 3660, ICF_WALL: 3050, CMU_WALL: 3050, PIER: 3050,
    };
    const elementHeightMm = lengthDefaults[elementType] || 3660;
    const numTies = Math.ceil(elementHeightMm / truth.ties.spacing_mm);
    const weight = weightPerFt * tiePerimeterFt * numTies;
    breakdown[`ties_${size}`] = weight;
    totalWeight += weight;
  }

  return { weight_lbs: totalWeight, breakdown };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { elements, mode } = await req.json();

    if (!elements || !Array.isArray(elements)) {
      return new Response(JSON.stringify({ error: "elements array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const quoteMode = mode || "ai_express"; // "ai_express" or "verified"

    // Pricing safety rule: reject FLAGGED/BLOCKED
    const nonReady = elements.filter((e: ElementTruth) => e.status !== "READY");
    
    if (quoteMode === "verified" && nonReady.length > 0) {
      return new Response(
        JSON.stringify({
          error: "PRICING_SAFETY_VIOLATION",
          message: `Verified mode requires ALL elements to be READY. Found ${nonReady.length} non-READY element(s).`,
          non_ready_elements: nonReady.map((e: ElementTruth) => ({
            element_id: e.element_id,
            status: e.status,
          })),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const readyElements = elements.filter((e: ElementTruth) => e.status === "READY");
    const excludedElements = elements.filter((e: ElementTruth) => e.status !== "READY");

    // For AI Express: hard error if a FLAGGED/BLOCKED is passed without proper separation
    if (quoteMode === "ai_express") {
      // Calculate only for READY elements
      let totalWeightLbs = 0;
      const elementWeights: any[] = [];
      const sizeBreakdown: Record<string, number> = {};

      for (const el of readyElements) {
        const { weight_lbs, breakdown } = calculateElementWeight(el.truth, el.element_type);
        totalWeightLbs += weight_lbs;
        elementWeights.push({
          element_id: el.element_id,
          element_type: el.element_type,
          weight_lbs: Math.round(weight_lbs * 100) / 100,
          breakdown,
        });
        for (const [key, val] of Object.entries(breakdown)) {
          sizeBreakdown[key] = (sizeBreakdown[key] || 0) + val;
        }
      }

      return new Response(
        JSON.stringify({
          mode: "ai_express",
          quote: {
            total_weight_lbs: Math.round(totalWeightLbs * 100) / 100,
            total_weight_tons: Math.round((totalWeightLbs / 2000) * 1000) / 1000,
            elements: elementWeights,
            size_breakdown: sizeBreakdown,
          },
          included_count: readyElements.length,
          excluded: excludedElements.map((e: ElementTruth) => ({
            element_id: e.element_id,
            status: e.status,
            reason: e.status === "FLAGGED" ? "Unresolved conflicts" : "Validation failed",
          })),
          excluded_count: excludedElements.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verified mode — all elements must be READY (already checked above)
    let totalWeightLbs = 0;
    const elementWeights: any[] = [];
    const sizeBreakdown: Record<string, number> = {};

    for (const el of readyElements) {
      const { weight_lbs, breakdown } = calculateElementWeight(el.truth, el.element_type);
      totalWeightLbs += weight_lbs;
      elementWeights.push({
        element_id: el.element_id,
        element_type: el.element_type,
        weight_lbs: Math.round(weight_lbs * 100) / 100,
        breakdown,
      });
      for (const [key, val] of Object.entries(breakdown)) {
        sizeBreakdown[key] = (sizeBreakdown[key] || 0) + val;
      }
    }

    return new Response(
      JSON.stringify({
        mode: "verified",
        quote: {
          total_weight_lbs: Math.round(totalWeightLbs * 100) / 100,
          total_weight_tons: Math.round((totalWeightLbs / 2000) * 1000) / 1000,
          elements: elementWeights,
          size_breakdown: sizeBreakdown,
        },
        included_count: readyElements.length,
        status: "complete",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("price-elements error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
