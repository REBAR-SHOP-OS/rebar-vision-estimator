import type { WorkflowFileRef, WorkflowQaIssue, WorkflowTakeoffRow } from "./takeoff-data";

export type ExtractionAuditStatus = "ready" | "needs_ocr_rerun" | "needs_engineer_review";

export interface IndexedPageAuditInput {
  page_number?: number | null;
  raw_text?: string | null;
  title_block?: Record<string, unknown> | null;
  is_scanned?: boolean | null;
  ocr_metadata?: {
    render_scale?: number | null;
    full_page_text_length?: number | null;
    crop_passes?: Array<{ kind?: string; text_length?: number; confidence?: number | null }>;
    skipped_reason?: string | null;
  } | null;
  extracted_entities?: {
    bar_marks?: string[];
    title_block?: Record<string, unknown> | null;
  } | null;
}

export interface ExtractionAuditResult {
  status: ExtractionAuditStatus;
  score: number;
  flags: string[];
  pageCount: number;
  indexedPages: number;
  sparsePages: number;
}

export interface EstimationAuditResult {
  status: "audit_complete" | "needs_answers" | "needs_ocr_review";
  checklist: Array<{ label: string; ok: boolean; detail: string }>;
  blockers: string[];
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export function auditIndexedPages(pages: IndexedPageAuditInput[], expectedPages?: number | null): ExtractionAuditResult {
  const flags = new Set<string>();
  const pageCount = Math.max(expectedPages || 0, pages.length);
  let sparsePages = 0;
  let penalties = 0;

  if (expectedPages && pages.length < expectedPages) {
    flags.add("skipped_pages");
    penalties += 0.25;
  }

  for (const page of pages) {
    const text = String(page.raw_text || "");
    const titleBlock = page.title_block || page.extracted_entities?.title_block || {};
    const barMarks = page.extracted_entities?.bar_marks || [];
    const textLength = text.trim().length;

    if (textLength < 80) {
      sparsePages++;
      flags.add("sparse_text");
      penalties += 0.08;
    }
    if (!hasText((titleBlock as Record<string, unknown>).sheet_number)) {
      flags.add("missing_sheet_id");
      penalties += 0.05;
    }
    if (!hasText((titleBlock as Record<string, unknown>).scale_raw) && !hasText((titleBlock as Record<string, unknown>).scale)) {
      flags.add("missing_scale");
      penalties += 0.03;
    }
    if (barMarks.length === 0 && !/\b(?:10M|15M|20M|25M|30M|35M|#[3-8])\b/i.test(text)) {
      flags.add("no_bar_marks");
      penalties += 0.03;
    }
    if (page.ocr_metadata?.skipped_reason) {
      flags.add(String(page.ocr_metadata.skipped_reason));
      penalties += 0.12;
    }
    if (page.is_scanned && Number(page.ocr_metadata?.render_scale || 0) < 2.25) {
      flags.add("low_dpi_ocr");
      penalties += 0.18;
    }
  }

  const score = Math.max(0, Math.round((1 - Math.min(0.9, penalties)) * 100) / 100);
  const status: ExtractionAuditStatus = flags.has("skipped_pages") || flags.has("low_dpi_ocr")
    ? "needs_ocr_rerun"
    : score < 0.72 || sparsePages > Math.max(1, pages.length * 0.25)
      ? "needs_engineer_review"
      : "ready";

  return {
    status,
    score,
    flags: Array.from(flags),
    pageCount,
    indexedPages: pages.length,
    sparsePages,
  };
}

export function buildEstimationAudit(params: {
  files: WorkflowFileRef[];
  rows: WorkflowTakeoffRow[];
  issues: WorkflowQaIssue[];
  extraction?: ExtractionAuditResult | null;
  estimatorConfirmed?: boolean;
}): EstimationAuditResult {
  const unresolvedRows = params.rows.filter((row) => row.geometry_status === "unresolved");
  const noEvidenceRows = params.rows.filter((row) => !row.source_file_id && !row.page_number);
  const duplicateKeys = new Set<string>();
  const duplicateRows = params.rows.filter((row) => {
    const key = `${row.segment_name}|${row.size}|${row.shape}`.toLowerCase();
    if (duplicateKeys.has(key)) return true;
    duplicateKeys.add(key);
    return false;
  });
  const qaOpen = params.issues.filter((issue) => !["resolved", "closed"].includes(String(issue.status || "").toLowerCase()));
  const extractionOk = !params.extraction || params.extraction.status === "ready";

  const checklist = [
    { label: "OCR complete", ok: extractionOk, detail: params.extraction ? `${params.extraction.indexedPages}/${params.extraction.pageCount || params.extraction.indexedPages} pages indexed` : "No extraction audit loaded" },
    { label: "All takeoff rows have evidence", ok: noEvidenceRows.length === 0, detail: `${noEvidenceRows.length} rows missing page/file evidence` },
    { label: "All quantities/lengths/weights resolved", ok: unresolvedRows.length === 0, detail: `${unresolvedRows.length} rows need answers` },
    { label: "No unresolved QA", ok: qaOpen.length === 0, detail: `${qaOpen.length} open QA issues` },
    { label: "No duplicate takeoff rows", ok: duplicateRows.length === 0, detail: `${duplicateRows.length} possible duplicates` },
    { label: "Final estimator confirmation", ok: Boolean(params.estimatorConfirmed), detail: params.estimatorConfirmed ? "Estimator confirmed" : "Estimator confirmation required" },
  ];

  const blockers = checklist.filter((item) => !item.ok).map((item) => `${item.label}: ${item.detail}`);
  const status = !extractionOk
    ? "needs_ocr_review"
    : blockers.length > (params.estimatorConfirmed ? 0 : 1)
      ? "needs_answers"
      : "audit_complete";

  return { status, checklist, blockers };
}
