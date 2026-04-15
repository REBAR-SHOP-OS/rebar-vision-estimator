import type { CanonicalEstimateLine } from "./canonical-types";

export type ReferenceDiffCategory =
  | "matched"
  | "missing_expected"
  | "extra_in_estimate"
  | "quantity_mismatch"
  | "mark_mismatch";

export interface ReferenceDiffEntry {
  category: ReferenceDiffCategory;
  normalized_key: string;
  expected?: { mark?: string | null; quantity?: number | null; unit?: string | null };
  actual?: { mark?: string | null; quantity?: number | null; unit?: string | null };
}

export interface ReferenceDiffSummary {
  entries: ReferenceDiffEntry[];
  counts: Record<ReferenceDiffCategory, number>;
  mismatch_ratio: number;
}

export function normalizeReferenceKey(mark: string | null | undefined, description: string | null | undefined): string {
  const a = (mark || "").trim().toUpperCase().replace(/\s+/g, "");
  const b = (description || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 80);
  const key = `${a}|${b}`;
  return (a || b) ? key : "unknown";
}

export function diffReferenceVsCanonical(
  referenceRows: { normalized_key: string; mark?: string | null; quantity?: number | null; unit?: string | null }[],
  canonicalLines: CanonicalEstimateLine[],
): ReferenceDiffSummary {
  const emptyCounts: Record<ReferenceDiffCategory, number> = {
    matched: 0,
    missing_expected: 0,
    extra_in_estimate: 0,
    quantity_mismatch: 0,
    mark_mismatch: 0,
  };
  if (!referenceRows.length) {
    return { entries: [], counts: emptyCounts, mismatch_ratio: 0 };
  }

  const refMap = new Map<string, { mark?: string | null; quantity?: number | null; unit?: string | null }>();
  for (const r of referenceRows) {
    refMap.set(r.normalized_key, { mark: r.mark, quantity: r.quantity, unit: r.unit });
  }

  const lineKeys = new Set<string>();
  const lineByNorm = new Map<string, CanonicalEstimateLine>();
  for (const line of canonicalLines) {
    if (line.review_required) continue;
    const nk = normalizeReferenceKey(line.bar_mark, line.description);
    lineKeys.add(nk);
    lineByNorm.set(nk, line);
  }

  const entries: ReferenceDiffEntry[] = [];
  const counts: Record<ReferenceDiffCategory, number> = {
    matched: 0,
    missing_expected: 0,
    extra_in_estimate: 0,
    quantity_mismatch: 0,
    mark_mismatch: 0,
  };

  for (const [nk, exp] of refMap) {
    const act = lineByNorm.get(nk);
    if (!act) {
      entries.push({ category: "missing_expected", normalized_key: nk, expected: exp });
      counts.missing_expected++;
      continue;
    }
    const qtyExp = exp.quantity != null ? Number(exp.quantity) : null;
    const qtyAct = act.qty;
    const markExp = (exp.mark || "").trim().toUpperCase();
    const markAct = (act.bar_mark || "").trim().toUpperCase();
    if (qtyExp != null && Math.abs(qtyExp - qtyAct) > 0.001 * Math.max(1, qtyExp)) {
      entries.push({
        category: "quantity_mismatch",
        normalized_key: nk,
        expected: exp,
        actual: { mark: act.bar_mark, quantity: qtyAct, unit: act.unit },
      });
      counts.quantity_mismatch++;
    } else if (markExp && markAct && markExp !== markAct) {
      entries.push({
        category: "mark_mismatch",
        normalized_key: nk,
        expected: exp,
        actual: { mark: act.bar_mark, quantity: qtyAct, unit: act.unit },
      });
      counts.mark_mismatch++;
    } else {
      entries.push({ category: "matched", normalized_key: nk });
      counts.matched++;
    }
  }

  for (const nk of lineKeys) {
    if (!refMap.has(nk)) {
      entries.push({ category: "extra_in_estimate", normalized_key: nk });
      counts.extra_in_estimate++;
    }
  }

  const denom = referenceRows.length || 1;
  const bad = counts.missing_expected + counts.quantity_mismatch + counts.mark_mismatch + counts.extra_in_estimate;
  const mismatch_ratio = bad / denom;

  return { entries, counts, mismatch_ratio };
}
