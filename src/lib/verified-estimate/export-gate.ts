import type { CanonicalEstimateLine } from "./canonical-types";
import { MIN_EXPORT_CONFIDENCE } from "./canonical-types";
import type { ReferenceDiffSummary } from "./reference-diff";

export interface ValidationIssueLike {
  severity?: string | null;
  status?: string | null;
  issue_type?: string | null;
}

export interface EstimationRuleLike {
  rule_type: string;
  payload: Record<string, unknown>;
  is_active?: boolean | null;
}

export interface ExportGateResult {
  canExport: boolean;
  blocked_reasons: string[];
}

const DEFAULT_REF_MISMATCH_MAX = 0.15;

function ruleNumber(rules: EstimationRuleLike[], key: string, fallback: number): number {
  for (const r of rules) {
    if (!r.is_active && r.is_active !== undefined) continue;
    if (r.rule_type === "export_threshold" && r.payload && typeof r.payload[key] === "number") {
      return r.payload[key] as number;
    }
  }
  return fallback;
}

/**
 * Enforces export gating: provenance, confidence, validation issues, optional reference diff.
 */
export function evaluateExportGate(input: {
  lines: CanonicalEstimateLine[];
  validationIssues: ValidationIssueLike[];
  referenceDiff: ReferenceDiffSummary | null;
  rules?: EstimationRuleLike[];
  /** If true, OCR-only lines without sheet linkage block export. */
  blockOcrOnly?: boolean;
}): ExportGateResult {
  const blocked_reasons: string[] = [];
  const rules = input.rules || [];
  const refMax = ruleNumber(rules, "max_reference_mismatch_ratio", DEFAULT_REF_MISMATCH_MAX);
  const minConf = ruleNumber(rules, "min_line_confidence", MIN_EXPORT_CONFIDENCE);

  if (input.lines.length === 0) {
    blocked_reasons.push("Blocked: no estimate lines in canonical snapshot.");
  }
  if (input.lines.length > 0 && !input.lines.some((l) => !l.review_required)) {
    blocked_reasons.push("Blocked: all lines are marked review_required — nothing committed for export.");
  }

  const committed = input.lines.filter((l) => !l.review_required);

  const missingTrace = committed.filter(
    (l) => !l.source_file_id || !l.source_sheet,
  ).length;
  if (missingTrace > 0) {
    blocked_reasons.push(
      `Blocked: ${missingTrace} estimate line(s) have no source file/sheet linkage (non-review lines).`,
    );
  }

  const lowConf = committed.filter((l) => l.confidence < minConf).length;
  if (lowConf > 0) {
    blocked_reasons.push(`Blocked: ${lowConf} line(s) below confidence threshold (${minConf}).`);
  }

  const ocrOnly = committed.filter(
    (l) =>
      (l.extraction_method === "ocr" || l.extraction_method === "ocr_full_page") &&
      input.blockOcrOnly !== false,
  ).length;
  if (ocrOnly > 0 && input.blockOcrOnly !== false) {
    blocked_reasons.push(`Blocked: ${ocrOnly} line(s) rely on OCR-only extraction without structured evidence.`);
  }

  const criticalOpen = input.validationIssues.filter(
    (i) => (i.severity === "critical" || i.severity === "error") && (i.status === "open" || !i.status),
  ).length;
  if (criticalOpen > 0) {
    blocked_reasons.push(`Blocked: ${criticalOpen} open critical validation issue(s).`);
  }

  if (input.referenceDiff && input.referenceDiff.entries.length > 0) {
    if (input.referenceDiff.mismatch_ratio > refMax) {
      blocked_reasons.push(
        `Blocked: estimate diverges from reference answer by ${(input.referenceDiff.mismatch_ratio * 100).toFixed(0)}% (max ${(refMax * 100).toFixed(0)}%).`,
      );
    }
  }

  const synthetic = committed.filter((l) => l.extraction_method === "llm_typical" || l.extraction_method === "synthetic").length;
  if (synthetic > 0) {
    blocked_reasons.push(`Blocked: ${synthetic} line(s) from non-evidence generation (llm_typical/synthetic).`);
  }

  return {
    canExport: blocked_reasons.length === 0,
    blocked_reasons,
  };
}
