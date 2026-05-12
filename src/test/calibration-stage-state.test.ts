import { describe, expect, it } from "vitest";
import { deriveCalibrationStageState } from "@/features/workflow-v2/stages/calibration-stage-state";

describe("deriveCalibrationStageState", () => {
  it("shows sheets mode as soon as indexed rows exist for the active project", () => {
    expect(deriveCalibrationStageState({
      fileCount: 1,
      indexRowCount: 3,
      documents: [],
    })).toEqual({ mode: "sheets" });
  });

  it("surfaces zero-row indexing as an upstream Stage 01 failure", () => {
    expect(deriveCalibrationStageState({
      fileCount: 1,
      indexRowCount: 0,
      documents: [
        {
          file_name: "S1.pdf",
          parse_status: "indexed",
          pdf_metadata: {
            indexing_diagnostics: {
              indexed_rows_verified: 0,
              failure_reason: "Indexing produced zero rows for this project.",
            },
          },
        },
      ],
      latestJob: { status: "failed", error_message: "Indexing produced zero rows for this project." },
    })).toEqual({
      mode: "empty",
      title: "Indexing produced zero sheets",
      hint: "Indexing produced zero rows for this project.",
    });
  });
});
