/**
 * Authoritative rebar weight tables and unit normalization utilities.
 * Single source of truth — imported by BarListTable, ExportButtons, tests, etc.
 */

// CSA G30.18 — kg/m (authoritative for metric sizes)
export const CSA_METRIC_KG_M: Record<string, number> = {
  "10M": 0.785,
  "15M": 1.570,
  "20M": 2.355,
  "25M": 3.925,
  "30M": 5.495,
  "35M": 7.850,
  "45M": 11.775,
  "55M": 19.625,
};

// Imperial — lb/ft
export const IMPERIAL_LB_FT: Record<string, number> = {
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

/** Returns mass in kg/m for any recognized rebar size */
export function getMassKgPerM(size: string): number {
  if (CSA_METRIC_KG_M[size]) return CSA_METRIC_KG_M[size];
  // Convert imperial lb/ft → kg/m: 1 lb/ft = 1.48816 kg/m
  if (IMPERIAL_LB_FT[size]) return IMPERIAL_LB_FT[size] * 1.48816;
  return 0;
}

/** Returns weight in lb/ft for display (imperial convention) */
export function getWeightLbPerFt(size: string): number {
  if (IMPERIAL_LB_FT[size]) return IMPERIAL_LB_FT[size];
  // Convert metric kg/m → lb/ft: 1 kg/m = 0.67197 lb/ft
  if (CSA_METRIC_KG_M[size]) return CSA_METRIC_KG_M[size] * 0.67197;
  return 0;
}

// ── Unit detection ──────────────────────────────────────────────

export type LengthUnit = "mm" | "m" | "ft" | "in";

export interface UnitDetectionResult {
  unit: LengthUnit;
  assumed: boolean;
}

export function detectLengthUnit(headers: string[]): UnitDetectionResult {
  const joined = headers.join(" ").toLowerCase();
  if (/mtr\.?|meter|metre/i.test(joined)) return { unit: "m", assumed: false };
  if (/millimeter|mm\b/i.test(joined)) return { unit: "mm", assumed: false };
  if (/feet|ft\b|foot/i.test(joined)) return { unit: "ft", assumed: false };
  if (/inch|in\b|"/i.test(joined)) return { unit: "in", assumed: false };
  return { unit: "mm", assumed: true };
}

export function toMm(value: number, unit: LengthUnit): number {
  switch (unit) {
    case "m": return value * 1000;
    case "ft": return value * 304.8;
    case "in": return value * 25.4;
    default: return value; // mm
  }
}

// ── Weight computation ──────────────────────────────────────────

export interface WeightComputationInput {
  size: string;
  qty: number;
  multiplier: number;
  length_mm: number;
}

/** Compute weight in kg from normalized inputs */
export function computeItemWeightKg(input: WeightComputationInput): number {
  const { size, qty, multiplier, length_mm } = input;
  const massKgM = getMassKgPerM(size);
  return qty * multiplier * (length_mm / 1000) * massKgM;
}

/** kg → lbs */
export function kgToLbs(kg: number): number {
  return kg / 0.453592;
}

/** lbs → kg */
export function lbsToKg(lbs: number): number {
  return lbs * 0.453592;
}
