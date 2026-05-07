import { describe, expect, it } from "vitest";
import { auditIndexedPages, buildEstimationAudit } from "@/features/workflow-v2/accuracy-audit";
import type { WorkflowTakeoffRow } from "@/features/workflow-v2/takeoff-data";

describe("accuracy audit", () => {
  it("flags skipped pages for high-DPI OCR rerun", () => {
    const result = auditIndexedPages([
      {
        page_number: 1,
        raw_text: "Sheet S-101 scale 1:100 15M foundation notes with enough searchable text.",
        title_block: { sheet_number: "S-101", scale: "1:100" },
        extracted_entities: { bar_marks: ["15M"] },
      },
    ], 3);

    expect(result.status).toBe("needs_ocr_rerun");
    expect(result.flags).toContain("skipped_pages");
    expect(result.indexedPages).toBe(1);
    expect(result.pageCount).toBe(3);
  });

  it("flags scanned pages rendered below the OCR scale floor", () => {
    const result = auditIndexedPages([
      {
        page_number: 1,
        raw_text: "Sheet S-101 scale 1:100 15M foundation notes with enough searchable text.",
        title_block: { sheet_number: "S-101", scale: "1:100" },
        is_scanned: true,
        ocr_metadata: { render_scale: 1.5, crop_passes: [{ kind: "title_block", text_length: 100 }] },
        extracted_entities: { bar_marks: ["15M"] },
      },
    ], 1);

    expect(result.status).toBe("needs_ocr_rerun");
    expect(result.flags).toContain("low_dpi_ocr");
  });

  it("passes a complete indexed page", () => {
    const result = auditIndexedPages([
      {
        page_number: 1,
        raw_text: "Sheet S-101 scale 1:100 foundation wall 15M @ 406mm O.C. with dimensions and notes.",
        title_block: { sheet_number: "S-101", scale: "1:100" },
        extracted_entities: { bar_marks: ["15M"] },
      },
    ], 1);

    expect(result.status).toBe("ready");
    expect(result.flags).toEqual([]);
  });

  it("keeps final audit blocked when rows still need evidence or answers", () => {
    const row: WorkflowTakeoffRow = {
      id: "legacy:item-1",
      raw_id: "item-1",
      raw_kind: "legacy",
      mark: "M001",
      size: "15M",
      shape: "foundation wall",
      count: 0,
      length: 0,
      weight: 0,
      status: "blocked",
      source: "Drawing",
      segment_id: null,
      segment_name: "Walls",
      source_file_id: null,
      geometry_status: "unresolved",
      missing_refs: ["element_dimensions"],
    };

    const result = buildEstimationAudit({
      files: [],
      rows: [row],
      issues: [],
      extraction: { status: "ready", score: 0.9, flags: [], pageCount: 1, indexedPages: 1, sparsePages: 0 },
      estimatorConfirmed: false,
    });

    expect(result.status).toBe("needs_answers");
    expect(result.blockers.join("\n")).toContain("All quantities/lengths/weights resolved");
  });

  it("marks audit complete only after estimator confirmation", () => {
    const result = buildEstimationAudit({
      files: [],
      rows: [{
        id: "legacy:item-1",
        raw_id: "item-1",
        raw_kind: "legacy",
        mark: "M001",
        size: "15M",
        shape: "foundation wall",
        count: 2,
        length: 10,
        weight: 31.4,
        status: "ready",
        source: "Drawing",
        segment_id: null,
        segment_name: "Walls",
        source_file_id: "file-1",
        geometry_status: "resolved",
        missing_refs: [],
        page_number: 12,
      }],
      issues: [],
      extraction: { status: "ready", score: 0.95, flags: [], pageCount: 1, indexedPages: 1, sparsePages: 0 },
      estimatorConfirmed: true,
    });

    expect(result.status).toBe("audit_complete");
    expect(result.blockers).toEqual([]);
  });
});
