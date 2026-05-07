import { describe, expect, it, vi } from "vitest";
import {
  applyAssistantSuggestion,
  buildFinishAuditResponse,
  buildAssistantSuggestion,
  isAssistantConfirmationIntent,
  isFinishAuditIntent,
  parseAssistantAnswerValues,
  type AssistantSuggestion,
} from "@/features/workflow-v2/stages/assistant-logic";
import type { WorkflowQaIssue, WorkflowTakeoffRow } from "@/features/workflow-v2/takeoff-data";

describe("workflow assistant logic", () => {
  it("detects confirmation language", () => {
    expect(isAssistantConfirmationIntent("yes apply this")).toBe(true);
    expect(isAssistantConfirmationIntent("what did you find?")).toBe(false);
  });

  it("detects final estimation audit intent", () => {
    expect(isFinishAuditIntent("finish estimation audit")).toBe(true);
    expect(isFinishAuditIntent("can you make this 100% confidence?")).toBe(true);
    expect(isFinishAuditIntent("what did you find for M008?")).toBe(false);
  });

  it("builds an audit checklist without claiming machine-only certainty", () => {
    const response = buildFinishAuditResponse({
      files: [],
      takeoffRows: [],
      qaIssues: [],
      extractionAudit: {
        status: "ready",
        score: 0.91,
        flags: [],
        pageCount: 2,
        indexedPages: 2,
        sparsePages: 0,
      },
      estimatorConfirmed: false,
    });

    expect(response).toContain("Audit Complete");
    expect(response).toContain("Final estimator confirmation");
    expect(response).toContain("Evidence quality");
    expect(response).not.toContain("100% confidence");
  });

  it("builds a suggestion from a QA issue and linked row", () => {
    const issue: WorkflowQaIssue = {
      id: "legacy:issue-1",
      title: "P12: foundation wall",
      description: "Missing: rebar callout; element dimensions",
      severity: "error",
      status: "open",
      issue_type: "unresolved_geometry",
      location_label: "P12",
      location: {
        page_number: 12,
        element_reference: "foundation wall",
        source_excerpt: 'Continuous horizontal bars @top of foundation wall w/ 800mm (32") hook',
      },
      linked_item: {
        id: "item-1",
        description: "foundation wall",
        bar_size: "15M",
        quantity_count: 0,
        total_length: 0,
        total_weight: 0,
        missing_refs: ["rebar_callout", "element_dimensions"],
      },
    };
    const row: WorkflowTakeoffRow = {
      id: "legacy:item-1",
      raw_id: "item-1",
      raw_kind: "legacy",
      mark: "M008",
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
      missing_refs: ["rebar_callout", "element_dimensions"],
    };

    const suggestion = buildAssistantSuggestion("check M008", { files: [], qaIssues: [issue], takeoffRows: [row] });

    expect(suggestion?.linkedTakeoffMark).toBe("M008");
    expect(suggestion?.answerText).toContain("continuous horizontal bars");
    expect(suggestion?.question).toContain("wall length and height");
  });

  it("parses confirmed dowel answers into takeoff values", () => {
    expect(parseAssistantAnswerValues('Found: run length 10000mm; use 400mm long 10M dowels @ 300mm O.C.; quantity = 34 dowels.')).toMatchObject({
      barSize: "10M",
      quantity: 34,
      totalLengthM: 13.6,
      weightKg: 10.68,
    });
  });

  it("updates validation issue and linked estimate item on confirmed apply", async () => {
    const calls: Array<{ table: string; update: Record<string, unknown>; id?: string }> = [];
    const sourceRefs = [{ estimate_item_id: "item-1" }];
    const assumptions = { geometry_status: "unresolved", missing_refs: ["element_dimensions"] };
    const from = vi.fn((table: string) => {
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: string) => {
          if (column === "id") query.id = value;
          return query;
        }),
        maybeSingle: vi.fn(() => Promise.resolve({
          data: table === "validation_issues"
            ? { source_refs: sourceRefs }
            : { id: "item-1", assumptions_json: assumptions, bar_size: "10M" },
          error: null,
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          calls.push({ table, update: patch, id: query.id });
          return {
            eq: vi.fn(() => Promise.resolve({ error: null })),
          };
        }),
      };
      return query;
    });
    const supabase = { from } as any;
    const suggestion: AssistantSuggestion = {
      issueId: "legacy:issue-1",
      issueTitle: "Issue",
      locationLabel: "P15",
      linkedEstimateItemId: "item-1",
      question: "Question",
      answerText: 'Found: run length 10000mm; use 400mm long 10M dowels @ 300mm O.C.; quantity = 34 dowels.',
      confidence: "high",
      needsConfirmation: true,
      structuredValues: {},
      missingRefs: ["element_dimensions"],
    };

    const result = await applyAssistantSuggestion(supabase, suggestion, suggestion.answerText, "resolved");

    expect(result.estimateUpdated).toBe(true);
    expect(calls.find((call) => call.table === "validation_issues")?.update.status).toBe("resolved");
    const itemPatch = calls.find((call) => call.table === "estimate_items")?.update;
    expect(itemPatch).toMatchObject({
      bar_size: "10M",
      quantity_count: 34,
      total_length: 13.6,
      total_weight: 10.68,
    });
    expect((itemPatch?.assumptions_json as Record<string, unknown>).geometry_status).toBe("resolved");
  });
});
