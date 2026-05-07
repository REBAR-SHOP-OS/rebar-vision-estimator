export const CANADIAN_BAR_MASS_KG_PER_M: Record<string, number> = {
  "10M": 0.785,
  "15M": 1.57,
  "20M": 2.355,
  "25M": 3.925,
  "30M": 5.495,
  "35M": 7.85,
};

export const CANADIAN_STOCK_LENGTH_M: Record<string, number> = {
  "10M": 12,
  "15M": 18,
  "20M": 18,
  "25M": 18,
  "30M": 18,
  "35M": 18,
};

export interface CanadianEstimateInput {
  barSize?: string | null;
  runLengthMm?: number | null;
  spacingMm?: number | null;
  pieceLengthMm?: number | null;
  quantity?: number | null;
}

export interface CanadianEstimateResult {
  barSize: string | null;
  quantity: number | null;
  pieceLengthM: number | null;
  totalLengthM: number | null;
  weightKg: number | null;
  rule: string;
}

export function normalizeCanadianBarSize(value?: string | null): string | null {
  const match = String(value || "").match(/\b(10M|15M|20M|25M|30M|35M)\b/i);
  return match?.[1]?.toUpperCase() || null;
}

export function countBarsBySpacing(distanceMm?: number | null, spacingMm?: number | null): number | null {
  if (!distanceMm || !spacingMm || distanceMm <= 0 || spacingMm <= 0) return null;
  return Math.floor(distanceMm / spacingMm) + 1;
}

export function footingCutLengthMm(dimensionMm?: number | null): number | null {
  if (!dimensionMm || dimensionMm <= 150) return null;
  return dimensionMm - 150;
}

export function columnTieOutsideMm(columnOutsideMm?: number | null): number | null {
  if (!columnOutsideMm || columnOutsideMm <= 80) return null;
  return columnOutsideMm - 80;
}

export function estimateCanadianLine(input: CanadianEstimateInput): CanadianEstimateResult {
  const barSize = normalizeCanadianBarSize(input.barSize);
  const quantity = input.quantity && input.quantity > 0
    ? Math.floor(input.quantity)
    : countBarsBySpacing(input.runLengthMm, input.spacingMm);
  const pieceLengthM = input.pieceLengthMm && input.pieceLengthMm > 0 ? input.pieceLengthMm / 1000 : null;
  const runLengthM = input.runLengthMm && input.runLengthMm > 0 ? input.runLengthMm / 1000 : null;
  const hasSpacing = Boolean(input.spacingMm && input.spacingMm > 0);
  const totalLengthM = quantity && pieceLengthM
    ? quantity * pieceLengthM
    : hasSpacing
      ? null
      : runLengthM;
  const mass = barSize ? CANADIAN_BAR_MASS_KG_PER_M[barSize] : null;
  const weightKg = totalLengthM && mass ? Number((totalLengthM * mass).toFixed(2)) : null;
  const rule = quantity && input.spacingMm
    ? "Canadian CAD: quantity = floor(run length / spacing) + 1"
    : "Canadian CAD: weight = total length x kg/m";

  return {
    barSize,
    quantity: quantity || null,
    pieceLengthM: pieceLengthM ? Number(pieceLengthM.toFixed(3)) : null,
    totalLengthM: totalLengthM ? Number(totalLengthM.toFixed(3)) : null,
    weightKg,
    rule,
  };
}

export function estimateCanadianPadBars(params: {
  barSize?: string | null;
  longDimensionMm?: number | null;
  shortDimensionMm?: number | null;
  spacingMm?: number | null;
  footingCoverRule?: boolean;
}) {
  const longQty = countBarsBySpacing(params.shortDimensionMm, params.spacingMm);
  const shortQty = countBarsBySpacing(params.longDimensionMm, params.spacingMm);
  const longCutMm = params.footingCoverRule ? footingCutLengthMm(params.longDimensionMm) : params.longDimensionMm || null;
  const shortCutMm = params.footingCoverRule ? footingCutLengthMm(params.shortDimensionMm) : params.shortDimensionMm || null;
  const longBars = estimateCanadianLine({
    barSize: params.barSize,
    quantity: longQty,
    pieceLengthMm: longCutMm,
  });
  const shortBars = estimateCanadianLine({
    barSize: params.barSize,
    quantity: shortQty,
    pieceLengthMm: shortCutMm,
  });

  return {
    longBars,
    shortBars,
    rule: "Canadian CAD: count bars across the opposite direction; footing bars use dimension - 150 mm when bar length is not shown.",
  };
}

export function parseFirstMetricLengthMm(text: string, labels: string[]): number | null {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")).join("|");
  const labeled = text.match(new RegExp(`\\b(?:${labelPattern})\\s*(?:=|:|is)?\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*(mm|m)\\b`, "i"));
  if (!labeled) return null;
  const value = Number(labeled[1].replace(/,/g, ""));
  return labeled[2].toLowerCase() === "m" ? value * 1000 : value;
}

export function parseSpacingMm(text: string): number | null {
  const match = text.match(/(?:@|at)\s*(\d+(?:\.\d+)?)\s*(mm|m)?\s*(?:\([^)]*\)\s*)?(?:O\.?\s*C\.?|on\s*cent(?:er|re))/i);
  if (!match) return null;
  const value = Number(match[1]);
  return (match[2] || "mm").toLowerCase() === "m" ? value * 1000 : value;
}

export function parsePieceLengthMm(text: string): number | null {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(mm|m)\s*(?:\([^)]*\)\s*)?(?:long|bar length|dowel)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2].toLowerCase() === "m" ? value * 1000 : value;
}
