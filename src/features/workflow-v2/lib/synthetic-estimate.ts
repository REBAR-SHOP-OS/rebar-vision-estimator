/**
 * Synthetic Best-Guess Estimate engine.
 * Used when OCR extracted bar callouts but no element dimensions.
 * All values produced are tagged in assumptions_json.synthetic_estimate=true
 * with assumed_dimensions listing every guess.
 */
import { CSA_METRIC_KG_M } from "@/lib/rebar-weights";

export const SYNTHETIC_DEFAULTS = {
  wallLengthM: 30,
  wallHeightM: 2.4,
  slabAreaM2: 100,
  footingRunM: 20,
  padRunM: 6,
};

export interface SyntheticInput {
  description: string;
  bar_size: string | null;
  source_text?: string;
}

export interface SyntheticResult {
  quantity_count: number;
  total_length: number;
  total_weight: number;
  assumed_dimensions: Record<string, string | number | boolean>;
  basis: string;
}

function parseSpacingMm(text: string): number | null {
  const m = text.match(/(?:@|at)\s*(\d+(?:\.\d+)?)\s*(mm|m)/i);
  if (!m) return null;
  return m[2].toLowerCase() === "m" ? Number(m[1]) * 1000 : Number(m[1]);
}
function parseThicknessMm(text: string): number | null {
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*mm\s+(?:frost\s+slab|foundation\s+wall|slab|wall|pad|footing)/i);
  return m ? Number(m[1]) : null;
}
function parsePieceLengthMm(text: string): number | null {
  const m = text.match(/\b(\d+)\s*mm\s+(?:long|dowels?|bars?)\b/i)
    || text.match(/x\s*(\d+)\s*mm/i);
  return m ? Number(m[1]) : null;
}
function parseExplicitQty(text: string): number | null {
  const m = text.match(/\((\d+)\)\s*(?:-|\s)*\d{1,2}M/i)
    || text.match(/\b(\d+)\s*-\s*\d{1,2}M\b/i);
  return m ? Number(m[1]) : null;
}
function detectKind(text: string): "wall" | "slab" | "footing" | "pad" | "dowel" | "unknown" {
  const t = text.toLowerCase();
  if (/dowel/.test(t)) return "dowel";
  if (/wall|\bfw\b/.test(t)) return "wall";
  if (/slab|\bsog\b|frost/.test(t)) return "slab";
  if (/footing|strip|grade beam/.test(t)) return "footing";
  if (/pad|pier|column/.test(t)) return "pad";
  return "unknown";
}

export function computeSyntheticEstimate(input: SyntheticInput): SyntheticResult | null {
  const text = `${input.description} ${input.source_text || ""}`;
  const bar = (input.bar_size || text.match(/\b(10M|15M|20M|25M|30M|35M)\b/i)?.[1] || "").toUpperCase();
  const kgPerM = CSA_METRIC_KG_M[bar];
  if (!kgPerM) return null;

  const D = SYNTHETIC_DEFAULTS;
  const spacingMm = parseSpacingMm(text);
  const thicknessMm = parseThicknessMm(text);
  const pieceMm = parsePieceLengthMm(text);
  const explicitQty = parseExplicitQty(text);
  const eachWay = /\beach\s+way\b|\be\.?\s*w\.?\b|\bmew\b/i.test(text);
  const kind = detectKind(text);

  const assumed: Record<string, string | number | boolean> = { bar, kgPerM };
  if (thicknessMm) assumed.thickness_mm = thicknessMm;
  let qty = 0, totalLengthM = 0, basis = "";

  if (explicitQty && pieceMm) {
    qty = explicitQty;
    totalLengthM = (pieceMm / 1000) * qty;
    assumed.qty_source = "explicit_callout";
    assumed.piece_length_m = pieceMm / 1000;
    basis = `${qty} bars × ${(pieceMm/1000).toFixed(3)}m piece length`;
  } else if (kind === "wall") {
    const L = D.wallLengthM, H = D.wallHeightM;
    assumed.assumed_wall_length_m = L;
    assumed.assumed_wall_height_m = H;
    if (spacingMm) {
      const s = spacingMm / 1000;
      const vertQty = Math.floor(L / s) + 1;
      const horizQty = Math.floor(H / s) + 1;
      const factor = eachWay ? 2 : 1;
      qty = (vertQty + horizQty) * factor;
      totalLengthM = (vertQty * H + horizQty * L) * factor;
      assumed.spacing_m = s;
      assumed.each_way = eachWay;
      basis = `Wall ${L}m × ${H}m @ ${spacingMm}mm O.C.${eachWay ? " EW" : ""}`;
    } else {
      qty = Math.round(L / 0.3) * (eachWay ? 2 : 1);
      totalLengthM = qty * H;
      basis = `Wall ${L}m × ${H}m, default 300mm spacing`;
    }
  } else if (kind === "slab") {
    const A = D.slabAreaM2, side = Math.sqrt(A);
    assumed.assumed_slab_area_m2 = A;
    assumed.assumed_slab_side_m = Number(side.toFixed(2));
    if (spacingMm) {
      const s = spacingMm / 1000;
      const perDir = Math.floor(side / s) + 1;
      qty = perDir * (eachWay ? 2 : 1);
      totalLengthM = perDir * side * (eachWay ? 2 : 1);
      assumed.spacing_m = s;
      assumed.each_way = eachWay;
      basis = `Slab ${side.toFixed(1)}×${side.toFixed(1)}m @ ${spacingMm}mm O.C.${eachWay ? " EW" : ""}`;
    } else {
      qty = Math.round(side / 0.3) * (eachWay ? 2 : 1);
      totalLengthM = qty * side;
      basis = `Slab ${side.toFixed(1)}×${side.toFixed(1)}m, default 300mm spacing`;
    }
  } else if (kind === "footing" || kind === "pad") {
    const L = kind === "pad" ? D.padRunM : D.footingRunM;
    assumed.assumed_run_m = L;
    if (spacingMm && pieceMm) {
      const s = spacingMm / 1000;
      qty = Math.floor(L / s) + 1;
      totalLengthM = qty * (pieceMm / 1000);
      basis = `${kind} run ${L}m @ ${spacingMm}mm O.C., piece ${pieceMm}mm`;
    } else if (spacingMm) {
      const s = spacingMm / 1000;
      qty = Math.floor(L / s) + 1;
      totalLengthM = qty * L;
      basis = `${kind} run ${L}m @ ${spacingMm}mm O.C.`;
    } else {
      qty = 4;
      totalLengthM = qty * L;
      basis = `${kind} run ${L}m, default 4 longitudinal bars`;
    }
  } else if (kind === "dowel") {
    const L = D.footingRunM;
    assumed.assumed_run_m = L;
    if (spacingMm && pieceMm) {
      const s = spacingMm / 1000;
      qty = Math.floor(L / s) + 1;
      totalLengthM = qty * (pieceMm / 1000);
      basis = `Dowel run ${L}m @ ${spacingMm}mm O.C., piece ${pieceMm}mm`;
    } else if (pieceMm) {
      qty = Math.floor(L / 0.3) + 1;
      totalLengthM = qty * (pieceMm / 1000);
      basis = `Dowel run ${L}m default 300mm spacing, piece ${pieceMm}mm`;
    } else {
      return null;
    }
  } else {
    if (pieceMm) {
      qty = explicitQty || 10;
      totalLengthM = qty * (pieceMm / 1000);
      basis = `${qty} bars × ${(pieceMm/1000).toFixed(3)}m (generic)`;
    } else {
      const L = D.footingRunM;
      qty = 4;
      totalLengthM = qty * L;
      assumed.assumed_run_m = L;
      basis = `Generic ${L}m run, 4 bars`;
    }
  }

  return {
    quantity_count: qty,
    total_length: Number(totalLengthM.toFixed(2)),
    total_weight: Number((totalLengthM * kgPerM).toFixed(1)),
    assumed_dimensions: assumed,
    basis,
  };
}
