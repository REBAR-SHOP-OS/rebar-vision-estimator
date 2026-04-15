import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Rebar weight per foot (lb/ft) — LOCKED
const REBAR_WEIGHT: Record<string, number> = {
  "#2": 0.167,  // NOTE: often plain/merchant bar; verify deformation requirement
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

// Canadian metric bar mass (kg/m) — CSA G30.18 / RSIC 2018
const METRIC_REBAR_MASS: Record<string, number> = {
  "10M": 0.785,
  "15M": 1.570,
  "20M": 2.355,
  "25M": 3.925,
  "30M": 5.495,
  "35M": 7.850,
  "45M": 11.775,
  "55M": 19.625,
};

// Metric to imperial size mapping
const METRIC_TO_IMPERIAL: Record<string, string> = {
  "10M": "#3", "15M": "#5", "20M": "#6", "25M": "#8",
  "30M": "#9", "35M": "#11", "45M": "#14", "55M": "#18",
};

// Standard mill lengths (metres) per RSIC
const METRIC_MILL_LENGTHS: Record<string, number> = {
  "10M": 12, "15M": 18, "20M": 18, "25M": 18,
  "30M": 18, "35M": 18, "45M": 18, "55M": 18,
};

// Resolve any size to lb/ft (handles both imperial and metric)
function getWeightPerFt(size: string): number {
  if (REBAR_WEIGHT[size]) return REBAR_WEIGHT[size];
  // Metric: convert kg/m to lb/ft
  if (METRIC_REBAR_MASS[size]) return METRIC_REBAR_MASS[size] * 0.671969; // 1 kg/m ≈ 0.671969 lb/ft
  // Try mapping metric to imperial
  const imp = METRIC_TO_IMPERIAL[size];
  if (imp && REBAR_WEIGHT[imp]) return REBAR_WEIGHT[imp];
  return 0;
}

interface BarLine {
  mark?: string;
  size: string;
  multiplier?: number;
  qty: number;
  length_mm?: number;
  length_ft?: number;
  shape?: string;
  info?: string;
  sheet_ref?: string;
  weight_kg?: number;
}

interface ElementTruth {
  element_id: string;
  element_type: string;
  truth: {
    vertical_bars?: { size: string; qty: number };
    ties?: { size: string; spacing_mm: number };
    bar_lines?: BarLine[];
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

// Get metric mass in kg/m for a bar size
function getMassKgPerM(size: string): number {
  if (METRIC_REBAR_MASS[size]) return METRIC_REBAR_MASS[size];
  // Imperial: convert lb/ft to kg/m  (1 lb/ft ≈ 1.48816 kg/m)
  if (REBAR_WEIGHT[size]) return REBAR_WEIGHT[size] * 1.48816;
  const imp = METRIC_TO_IMPERIAL[size];
  if (imp && REBAR_WEIGHT[imp]) return REBAR_WEIGHT[imp] * 1.48816;
  return 0;
}

// Coating price multipliers
const COATING_MULTIPLIERS: Record<string, number> = {
  EPOXY: 1.20,
  GALVANISED: 1.35,
  STAINLESS: 6.0,
  MMFX: 1.50,
  HIGH_STRENGTH: 1.50,
  COATED_OTHER: 1.25,
};

function calculateElementWeight(truth: ElementTruth["truth"], elementType: string): {
  weight_lbs: number;
  weight_kg: number;
  breakdown: Record<string, number>;
  breakdown_kg: Record<string, number>;
  bar_list_entries: { bar_mark: string; size: string; shape_code: string; qty: number; length_ft: number; weight_lbs: number; weight_kg: number; coating?: string }[];
  missing_length_count: number;
  missing_length_bars: string[];
  coating?: string;
  coating_multiplier?: number;
} {
  const breakdown: Record<string, number> = {};
  const breakdown_kg: Record<string, number> = {};
  const coating = truth.coating && truth.coating !== "none" && truth.coating !== "BLACK" ? truth.coating : null;
  const coatingMult = coating ? (COATING_MULTIPLIERS[coating] || 1.0) : 1.0;
  let totalWeight_kg = 0;
  const bar_list_entries: any[] = [];
  const missing_length_bars: string[] = [];
  let missing_length_count = 0;

  // ── PRIMARY PATH: bar_lines array (actual extracted data) ──
  if (truth.bar_lines && Array.isArray(truth.bar_lines) && truth.bar_lines.length > 0) {
    for (const line of truth.bar_lines) {
      const size = line.size;
      const mult = line.multiplier || 1;
      const qty = line.qty || 0;
      let weight_kg = 0;

      if (line.length_mm && line.length_mm > 0) {
        const massKgM = getMassKgPerM(size);
        weight_kg = mult * qty * (line.length_mm / 1000) * massKgM;
      } else if (line.length_ft && line.length_ft > 0) {
        const wPerFt = getWeightPerFt(size);
        const weight_lbs = mult * qty * line.length_ft * wPerFt;
        weight_kg = weight_lbs * 0.453592;
      } else if (line.weight_kg && line.weight_kg > 0) {
        console.warn(`[weight-fallback] Using AI-provided weight_kg=${line.weight_kg} for ${line.mark || "unknown"} (${size}) — no length data available`);
        weight_kg = line.weight_kg;
      } else {
        // No length and no pre-computed weight — track as missing
        missing_length_count++;
        missing_length_bars.push(`${line.mark || "unknown"} (${size})`);
      }

      const key = `${line.info || "bar"}_${size}`;
      breakdown_kg[key] = (breakdown_kg[key] || 0) + weight_kg;
      const weight_lbs = weight_kg / 0.453592;
      breakdown[key] = (breakdown[key] || 0) + weight_lbs;
      totalWeight_kg += weight_kg;

      const lengthFt = line.length_ft || (line.length_mm ? line.length_mm / 304.8 : 0);
      bar_list_entries.push({
        bar_mark: line.mark || "—",
        size,
        shape_code: line.shape || "straight",
        qty: mult * qty,
        length_ft: Math.round(lengthFt * 100) / 100,
        weight_lbs: Math.round(weight_lbs * 100) / 100,
        weight_kg: Math.round(weight_kg * 100) / 100,
        ...(coating ? { coating } : {}),
      });
    }

    // Apply coating multiplier to total
    totalWeight_kg *= coatingMult;
    // Recompute breakdowns with multiplier
    if (coatingMult !== 1.0) {
      for (const k of Object.keys(breakdown_kg)) breakdown_kg[k] *= coatingMult;
      for (const k of Object.keys(breakdown)) breakdown[k] *= coatingMult;
    }
    const totalWeight_lbs = totalWeight_kg / 0.453592;
    return { weight_lbs: totalWeight_lbs, weight_kg: totalWeight_kg, breakdown, breakdown_kg, bar_list_entries, missing_length_count, missing_length_bars, ...(coating ? { coating, coating_multiplier: coatingMult } : {}) };
  }

  // ── FALLBACK PATH: legacy vertical_bars + ties (hardcoded lengths) ──
  const SLAB_TYPES = ["SLAB", "RAFT_SLAB", "SLAB_STRIP"];
  const HOOK_EXTENSION: Record<string, number> = {
    "#3": 5, "#4": 6, "#5": 7, "#6": 8, "#7": 10, "#8": 11,
    "#9": 13, "#10": 15, "#11": 17, "#14": 22, "#18": 28,
  };

  if (SLAB_TYPES.includes(elementType) && truth.area_sqft && truth.mesh_type) {
    const w = truth.area_sqft * 0.85;
    breakdown[`mesh_${truth.mesh_type || "standard"}`] = w;
    totalWeight_kg += w * 0.453592;
  }

  if (elementType === "WIRE_MESH" && truth.area_sqft) {
    const w = truth.area_sqft * 0.85;
    breakdown["wire_mesh"] = w;
    totalWeight_kg += w * 0.453592;
  }

  if (truth.vertical_bars?.size && truth.vertical_bars?.qty) {
    const size = truth.vertical_bars.size;
    const qty = truth.vertical_bars.qty;
    const weightPerFt = getWeightPerFt(size);
    const lengthDefaults: Record<string, number> = {
      COLUMN: 12, WALL: 12, FOOTING: 6, BEAM: 20, GRADE_BEAM: 20,
      RETAINING_WALL: 12, ICF_WALL: 10, CMU_WALL: 10, PIER: 10,
      STAIR: 8, SLAB: 10, RAFT_SLAB: 10, SLAB_STRIP: 20,
    };
    let lengthFt = lengthDefaults[elementType] || 12;
    const shapeCode = truth.shape_code || "straight";
    if (shapeCode !== "straight") {
      const hookExt = HOOK_EXTENSION[size] || 8;
      const bd = truth.bend_details || {};
      const leg1 = (bd.leg1_in || 0) / 12;
      const leg2 = (bd.leg2_in || 0) / 12;
      const hookFt = (bd.hook_ext_in || hookExt) / 12;
      if (shapeCode === "L-bend") lengthFt += leg1 + hookFt;
      else if (shapeCode === "U-bend") lengthFt += leg1 + leg2 + hookFt;
      else if (shapeCode === "hook") lengthFt += hookFt;
    }
    if (truth.splice_length_in) lengthFt += truth.splice_length_in / 12;
    const weight = weightPerFt * lengthFt * qty;
    breakdown[`vertical_${size}`] = weight;
    totalWeight_kg += weight * 0.453592;
    bar_list_entries.push({
      bar_mark: truth.bar_mark || "—", size, shape_code: shapeCode, qty,
      length_ft: Math.round(lengthFt * 100) / 100,
      weight_lbs: Math.round(weight * 100) / 100,
      weight_kg: Math.round(weight * 0.453592 * 100) / 100,
      ...(coating ? { coating } : {}),
    });
  }

  if (truth.ties?.size && truth.ties?.spacing_mm) {
    const size = truth.ties.size;
    const weightPerFt = getWeightPerFt(size);
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
    totalWeight_kg += weight * 0.453592;
    bar_list_entries.push({
      bar_mark: "TIE", size, shape_code: "closed", qty: numTies,
      length_ft: Math.round(tiePerimeterFt * 100) / 100,
      weight_lbs: Math.round(weight * 100) / 100,
      weight_kg: Math.round(weight * 0.453592 * 100) / 100,
      ...(coating ? { coating } : {}),
    });
  }

  // Apply coating multiplier
  totalWeight_kg *= coatingMult;
  if (coatingMult !== 1.0) {
    for (const k of Object.keys(breakdown_kg)) breakdown_kg[k] *= coatingMult;
    for (const k of Object.keys(breakdown)) breakdown[k] *= coatingMult;
  }
  const totalWeight_lbs = totalWeight_kg / 0.453592;
  // Build breakdown_kg from breakdown
  for (const [k, v] of Object.entries(breakdown)) {
    if (!breakdown_kg[k]) breakdown_kg[k] = v * 0.453592;
  }
  return { weight_lbs: totalWeight_lbs, weight_kg: totalWeight_kg, breakdown, breakdown_kg, bar_list_entries, missing_length_count, missing_length_bars, ...(coating ? { coating, coating_multiplier: coatingMult } : {}) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { elements, mode } = await req.json();

    if (!elements || !Array.isArray(elements)) {
      return new Response(JSON.stringify({ error: "elements array is required" }), {
        status: 400,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
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
        { status: 400, headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    const readyElements = elements.filter((e: ElementTruth) => e.status === "READY");
    const excludedElements = elements.filter((e: ElementTruth) => e.status !== "READY");

    // For AI Express: hard error if a FLAGGED/BLOCKED is passed without proper separation
    if (quoteMode === "ai_express") {
      let totalWeightLbs = 0;
      let totalWeightKg = 0;
      const elementWeights: any[] = [];
      const sizeBreakdown: Record<string, number> = {};
      const sizeBreakdownKg: Record<string, number> = {};
      const allBarListEntries: any[] = [];
      let totalMissingLength = 0;
      const allMissingLengthBars: string[] = [];

      for (const el of readyElements) {
        const { weight_lbs, weight_kg, breakdown, breakdown_kg, bar_list_entries, missing_length_count, missing_length_bars } = calculateElementWeight(el.truth, el.element_type);
        totalWeightLbs += weight_lbs;
        totalWeightKg += weight_kg;
        totalMissingLength += missing_length_count;
        allMissingLengthBars.push(...missing_length_bars);
        elementWeights.push({
          element_id: el.element_id,
          element_type: el.element_type,
          weight_lbs: Math.round(weight_lbs * 100) / 100,
          weight_kg: Math.round(weight_kg * 100) / 100,
          breakdown,
          breakdown_kg,
          bar_list_entries,
          missing_length_count,
          missing_length_bars,
        });
        allBarListEntries.push(...bar_list_entries.map(b => ({ ...b, element_id: el.element_id, element_type: el.element_type })));
        for (const [key, val] of Object.entries(breakdown)) {
          sizeBreakdown[key] = (sizeBreakdown[key] || 0) + val;
        }
        for (const [key, val] of Object.entries(breakdown_kg)) {
          sizeBreakdownKg[key] = (sizeBreakdownKg[key] || 0) + val;
        }
      }

      return new Response(
        JSON.stringify({
          mode: "ai_express",
          quote: {
            total_weight_lbs: Math.round(totalWeightLbs * 100) / 100,
            total_weight_kg: Math.round(totalWeightKg * 100) / 100,
            total_weight_tons: Math.round((totalWeightLbs / 2000) * 1000) / 1000,
            total_weight_tonnes: Math.round((totalWeightKg / 1000) * 1000) / 1000,
            elements: elementWeights,
            size_breakdown: sizeBreakdown,
            size_breakdown_kg: sizeBreakdownKg,
            bar_list: allBarListEntries,
          },
          missing_length_count: totalMissingLength,
          missing_length_bars: allMissingLengthBars,
          included_count: readyElements.length,
          excluded: excludedElements.map((e: ElementTruth) => ({
            element_id: e.element_id,
            status: e.status,
            reason: e.status === "FLAGGED" ? "Unresolved conflicts" : "Validation failed",
          })),
          excluded_count: excludedElements.length,
        }),
        { headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    let totalWeightLbs = 0;
    let totalWeightKg = 0;
    const elementWeights: any[] = [];
    const sizeBreakdown: Record<string, number> = {};
    const sizeBreakdownKg: Record<string, number> = {};
    const allBarListEntries: any[] = [];
    let totalMissingLength = 0;
    const allMissingLengthBars: string[] = [];

    for (const el of readyElements) {
      const { weight_lbs, weight_kg, breakdown, breakdown_kg, bar_list_entries, missing_length_count, missing_length_bars } = calculateElementWeight(el.truth, el.element_type);
      totalWeightLbs += weight_lbs;
      totalWeightKg += weight_kg;
      totalMissingLength += missing_length_count;
      allMissingLengthBars.push(...missing_length_bars);
      elementWeights.push({
        element_id: el.element_id,
        element_type: el.element_type,
        weight_lbs: Math.round(weight_lbs * 100) / 100,
        weight_kg: Math.round(weight_kg * 100) / 100,
        breakdown,
        breakdown_kg,
        bar_list_entries,
        missing_length_count,
        missing_length_bars,
      });
      allBarListEntries.push(...bar_list_entries.map(b => ({ ...b, element_id: el.element_id, element_type: el.element_type })));
      for (const [key, val] of Object.entries(breakdown)) {
        sizeBreakdown[key] = (sizeBreakdown[key] || 0) + val;
      }
      for (const [key, val] of Object.entries(breakdown_kg)) {
        sizeBreakdownKg[key] = (sizeBreakdownKg[key] || 0) + val;
      }
    }

    return new Response(
      JSON.stringify({
        mode: "verified",
        quote: {
          total_weight_lbs: Math.round(totalWeightLbs * 100) / 100,
          total_weight_kg: Math.round(totalWeightKg * 100) / 100,
          total_weight_tons: Math.round((totalWeightLbs / 2000) * 1000) / 1000,
          total_weight_tonnes: Math.round((totalWeightKg / 1000) * 1000) / 1000,
          elements: elementWeights,
          size_breakdown: sizeBreakdown,
          size_breakdown_kg: sizeBreakdownKg,
          bar_list: allBarListEntries,
        },
        missing_length_count: totalMissingLength,
        missing_length_bars: allMissingLengthBars,
        included_count: readyElements.length,
        status: "complete",
      }),
      { headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("price-elements error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
