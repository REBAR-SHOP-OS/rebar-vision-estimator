export interface PopulateSearchIndexResponse {
  indexed?: number | null;
  skipped?: number | null;
  total?: number | null;
  duplicate_of?: string | null;
  message?: string | null;
  errors?: string[] | null;
  conflicts?: string[] | null;
  quality_issues?: string[] | null;
  discipline_counts?: Record<string, number> | null;
}

export interface IndexingDiagnostics {
  upload_received_at?: string;
  parse_started_at?: string;
  ocr_completed_at?: string;
  project_id?: string;
  file_id?: string;
  document_version_id?: string | null;
  source?: string;
  status?: "parsing" | "indexed" | "failed";
  requested_pages?: number;
  indexed_rows_reported?: number;
  indexed_rows_verified?: number;
  skipped_pages?: number;
  discipline_counts?: Record<string, number>;
  conflicts?: string[];
  quality_issues?: string[];
  failure_reason?: string | null;
}

export interface IndexingOutcomeSummary {
  ok: boolean;
  reportedRows: number;
  verifiedRows: number;
  error?: string;
}

export function summarizeIndexingOutcome(input: {
  requestedPages: number;
  verifiedRows: number;
  response?: PopulateSearchIndexResponse | null;
}): IndexingOutcomeSummary {
  const { requestedPages, verifiedRows, response } = input;
  const reportedRows = Math.max(0, Number(response?.indexed ?? 0));

  if (verifiedRows > 0) {
    return { ok: true, reportedRows, verifiedRows };
  }

  if (requestedPages === 0) {
    return {
      ok: false,
      reportedRows,
      verifiedRows,
      error: "Parsing produced no pages to index.",
    };
  }

  const responseError = response?.errors?.find(Boolean)
    || response?.message
    || (response?.duplicate_of
      ? "Indexing was skipped as a duplicate before any rows were written to this project."
      : null);

  return {
    ok: false,
    reportedRows,
    verifiedRows,
    error: responseError || "Indexing produced zero rows for this project.",
  };
}
