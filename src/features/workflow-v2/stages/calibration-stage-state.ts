export interface CalibrationDocumentVersion {
  file_name?: string | null;
  parse_status?: string | null;
  parse_error?: string | null;
  pdf_metadata?: {
    indexing_diagnostics?: {
      indexed_rows_verified?: number | null;
      failure_reason?: string | null;
    } | null;
  } | null;
}

export interface CalibrationProcessingJob {
  status?: string | null;
  error_message?: string | null;
}

export interface CalibrationStageStateSummary {
  mode: "sheets" | "empty";
  title?: string;
  hint?: string;
}

export function deriveCalibrationStageState(args: {
  fileCount: number;
  indexRowCount: number;
  documents: CalibrationDocumentVersion[];
  latestJob?: CalibrationProcessingJob | null;
}): CalibrationStageStateSummary {
  const { fileCount, indexRowCount, documents, latestJob } = args;

  if (indexRowCount > 0) return { mode: "sheets" };

  if (fileCount === 0) {
    return {
      mode: "empty",
      title: "No indexed sheets yet",
      hint: "Upload and parse drawings in Stage 01 first.",
    };
  }

  const failedDoc = documents.find((doc) => doc.parse_status === "failed");
  if (failedDoc) {
    return {
      mode: "empty",
      title: "Indexing failed upstream",
      hint: failedDoc.parse_error || `Retry parsing ${failedDoc.file_name || "the uploaded drawings"} in Stage 01.`,
    };
  }

  if (documents.some((doc) => doc.parse_status === "pending" || doc.parse_status === "parsing")) {
    return {
      mode: "empty",
      title: "Parsing/indexing still running",
      hint: "Stage 03 will unlock once Stage 01 finishes writing indexed sheet rows.",
    };
  }

  const zeroRowDoc = documents.find((doc) => {
    if (doc.parse_status !== "indexed") return false;
    return Number(doc.pdf_metadata?.indexing_diagnostics?.indexed_rows_verified ?? 0) === 0;
  });
  if (zeroRowDoc) {
    return {
      mode: "empty",
      title: "Indexing produced zero sheets",
      hint:
        zeroRowDoc.pdf_metadata?.indexing_diagnostics?.failure_reason
        || latestJob?.error_message
        || "Stage 01 completed without writing drawing_search_index rows for this project. Retry indexing in Stage 01.",
    };
  }

  if (latestJob?.status === "failed") {
    return {
      mode: "empty",
      title: "Indexing failed upstream",
      hint: latestJob.error_message || "Retry parsing/indexing in Stage 01.",
    };
  }

  return {
    mode: "empty",
    title: "No indexed sheets yet",
    hint: "Upload and parse drawings in Stage 01 first.",
  };
}
