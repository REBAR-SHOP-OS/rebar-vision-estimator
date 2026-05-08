import { describe, it, expect } from "vitest";
import { stableStringify, sha256HexOfJson } from "@/lib/verified-estimate/canonical-hash";
import { evaluateExportGate } from "@/lib/verified-estimate/export-gate";
import { diffReferenceVsCanonical, normalizeReferenceKey } from "@/lib/verified-estimate/reference-diff";
import {
  buildCanonicalResultFromWorkspace,
  buildCanonicalResultFromChatQuote,
} from "@/lib/verified-estimate/build-canonical-result";
import type { CanonicalEstimateLine } from "@/lib/verified-estimate/canonical-types";
import { validateStage2Quote } from "@/lib/verified-estimate/stage2-schema";
import { persistVerifiedEstimateFromChat } from "@/lib/verified-estimate/verified-estimate-store";

describe("canonical-hash", () => {
  it("produces same string for key reorder", () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    const b = { a: { b: 3, y: 2 }, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("same content yields same sha256", async () => {
    const h1 = await sha256HexOfJson({ foo: [{ c: 1, b: 2 }], a: 0 });
    const h2 = await sha256HexOfJson({ a: 0, foo: [{ b: 2, c: 1 }] });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("export-gate", () => {
  it("blocks when no lines", () => {
    const g = evaluateExportGate({ lines: [], validationIssues: [], referenceDiff: null });
    expect(g.canExport).toBe(false);
    expect(g.blocked_reasons.some((r) => r.includes("no estimate lines"))).toBe(true);
  });

  it("blocks when all review_required", () => {
    const lines: CanonicalEstimateLine[] = [
      {
        line_key: "1",
        description: "x",
        size: "20M",
        qty: 1,
        multiplier: 1,
        length_mm: 6000,
        weight_kg: 10,
        unit: "kg",
        source_file_id: "f1",
        source_file_name: "a.pdf",
        source_sheet: "S1",
        source_region: null,
        extraction_method: "test",
        confidence: 0.9,
        validation_status: "ok",
        review_required: true,
      },
    ];
    const g = evaluateExportGate({ lines, validationIssues: [], referenceDiff: null });
    expect(g.canExport).toBe(false);
  });

  it("blocks low confidence committed lines", () => {
    const lines: CanonicalEstimateLine[] = [
      {
        line_key: "1",
        description: "x",
        size: "20M",
        qty: 1,
        multiplier: 1,
        length_mm: 6000,
        weight_kg: 10,
        unit: "kg",
        source_file_id: "f1",
        source_file_name: "a.pdf",
        source_sheet: "S1",
        source_region: null,
        extraction_method: "vector_pdf",
        confidence: 0.2,
        validation_status: "ok",
        review_required: false,
      },
    ];
    const g = evaluateExportGate({ lines, validationIssues: [], referenceDiff: null });
    expect(g.canExport).toBe(false);
  });

  it("blocks synthetic extraction_method", () => {
    const lines: CanonicalEstimateLine[] = [
      {
        line_key: "1",
        description: "x",
        size: "20M",
        qty: 1,
        multiplier: 1,
        length_mm: 6000,
        weight_kg: 10,
        unit: "kg",
        source_file_id: "f1",
        source_file_name: "a.pdf",
        source_sheet: "S1",
        source_region: null,
        extraction_method: "synthetic",
        confidence: 0.95,
        validation_status: "ok",
        review_required: false,
      },
    ];
    const g = evaluateExportGate({ lines, validationIssues: [], referenceDiff: null });
    expect(g.canExport).toBe(false);
  });

  it("passes with grounded committed line", () => {
    const lines: CanonicalEstimateLine[] = [
      {
        line_key: "1",
        description: "x",
        size: "20M",
        qty: 1,
        multiplier: 1,
        length_mm: 6000,
        weight_kg: 10,
        unit: "kg",
        source_file_id: "f1",
        source_file_name: "a.pdf",
        source_sheet: "S1",
        source_region: null,
        extraction_method: "vector_pdf",
        confidence: 0.9,
        validation_status: "ok",
        review_required: false,
      },
    ];
    const g = evaluateExportGate({ lines, validationIssues: [], referenceDiff: null });
    expect(g.canExport).toBe(true);
  });
});

describe("reference-diff", () => {
  it("returns empty when no reference rows", () => {
    const lines: CanonicalEstimateLine[] = [
      {
        line_key: "a",
        description: "B1",
        size: "20M",
        qty: 2,
        multiplier: 1,
        length_mm: 0,
        weight_kg: 1,
        unit: "kg",
        bar_mark: "B1",
        source_file_id: "f",
        source_file_name: null,
        source_sheet: "S1",
        source_region: null,
        extraction_method: "x",
        confidence: 0.9,
        validation_status: "ok",
        review_required: false,
      },
    ];
    const d = diffReferenceVsCanonical([], lines);
    expect(d.mismatch_ratio).toBe(0);
    expect(d.counts.extra_in_estimate).toBe(0);
  });

  it("detects missing expected", () => {
    const nk = normalizeReferenceKey("X1", "foo");
    const d = diffReferenceVsCanonical([{ normalized_key: nk, mark: "X1", quantity: 5, unit: "ea" }], []);
    expect(d.counts.missing_expected).toBe(1);
  });
});

describe("buildCanonicalResultFromWorkspace", () => {
  it("is deterministic for same bar ordering", () => {
    const input = {
      segments: [{ id: "s1", name: "Footings", segment_type: "footing" }],
      barItems: [
        { id: "b2", segment_id: "s1", mark: "B2", shape_code: "s", cut_length: 6000, quantity: 2, size: "20M", finish_type: "black", confidence: 0.8 },
        { id: "b1", segment_id: "s1", mark: "B1", shape_code: "s", cut_length: 6000, quantity: 1, size: "15M", finish_type: "black", confidence: 0.8 },
      ],
      estimateItems: [] as any[],
      files: [{ id: "f1", file_name: "struct.pdf" }],
      segmentSources: new Map([["s1", ["f1"]]]),
      docVersionToFile: new Map([["dv1", "f1"]]),
      documentSheets: [{ document_version_id: "dv1", page_number: 1, sheet_number: "S-101" }],
    };
    const a = buildCanonicalResultFromWorkspace(input);
    const b = buildCanonicalResultFromWorkspace({
      ...input,
      barItems: [...input.barItems].reverse(),
    });
    expect(a.lines.map((l) => l.line_key)).toEqual(b.lines.map((l) => l.line_key));
    expect(a.quote.total_weight_kg).toBe(b.quote.total_weight_kg);
  });
});

describe("buildCanonicalResultFromChatQuote", () => {
  it("marks fallback and missing provenance as review_required", () => {
    const parsed = validateStage2Quote({
      bar_list: [{ size: "20M", qty: 1, length_mm: 6000, element_id: "E1" }],
      size_breakdown_kg: { "20M": 14 },
      total_weight_kg: 14,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Expected parsed quote");

    const r = buildCanonicalResultFromChatQuote({
      elements: [],
      quote: parsed.data,
      usedFallbackJson: true,
    });
    expect(r.lines[0].review_required).toBe(true);
    expect(r.lines[0].extraction_method).toBe("llm_fallback_json");
  });
});

describe("validateStage2Quote", () => {
  it("accepts a valid stage 2 quote", () => {
    const result = validateStage2Quote({
      bar_list: [
        { size: "20M", qty: "2", length_mm: "6000", multiplier: "1", weight_kg: "28.4", element_id: "C1" },
      ],
      size_breakdown_kg: { "20M": "28.4" },
      total_weight_kg: "28.4",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing bar_list", () => {
    const result = validateStage2Quote({
      size_breakdown_kg: { "20M": 28.4 },
      total_weight_kg: 28.4,
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected schema failure");
    expect(result.error.blockedReasons[0]).toContain("quote.bar_list");
  });

  it("rejects non-array bar_list", () => {
    const result = validateStage2Quote({
      bar_list: {},
      size_breakdown_kg: { "20M": 28.4 },
      total_weight_kg: 28.4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed bar rows", () => {
    const result = validateStage2Quote({
      bar_list: [{ qty: 1, length_mm: "oops" }],
      size_breakdown_kg: { "20M": 28.4 },
      total_weight_kg: 28.4,
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected schema failure");
    expect(result.error.issues.some((issue) => issue.includes("quote.bar_list[0].size"))).toBe(true);
  });

  it("rejects invalid size_breakdown values", () => {
    const result = validateStage2Quote({
      bar_list: [{ size: "20M", qty: 2, length_mm: 6000 }],
      size_breakdown_kg: { "20M": "bad" },
      total_weight_kg: 28.4,
    });
    expect(result.success).toBe(false);
  });
});

describe("persistVerifiedEstimateFromChat", () => {
  it("fails fast on schema mismatch before persistence", async () => {
    const result = await persistVerifiedEstimateFromChat({} as never, {
      projectId: "p1",
      userId: "u1",
      elements: [],
      quote: { total_weight_kg: 12 },
      usedFallbackJson: false,
    });

    expect(result.ok).toBe(false);
    if (!("kind" in result)) throw new Error("Expected persistence failure");
    expect(result.kind).toBe("schema_validation_failed");
    expect(result.gate.canExport).toBe(false);
    expect(result.gate.blocked_reasons.some((reason) => reason.includes("quote.bar_list"))).toBe(true);
  });
});
