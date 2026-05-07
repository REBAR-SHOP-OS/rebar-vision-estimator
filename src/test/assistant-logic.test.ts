import { describe, expect, it, vi } from "vitest";
import {
  applyAssistantSuggestion,
  buildFinishEstimationAgentResponse,
  buildFinishAuditResponse,
  buildAssistantSuggestion,
  buildNextEstimationAgentResponse,
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

  it("builds a finish-estimation agent response with row findings and an applyable suggestion", () => {
    const issue: WorkflowQaIssue = {
      id: "legacy:issue-brick",
      title: "P17: brick ledge",
      description: "Look at P17. Find the brick ledge.",
      severity: "error",
      status: "open",
      issue_type: "unresolved_geometry",
      location_label: "P17",
      location: {
        page_number: 17,
        element_reference: "brick ledge",
        source_excerpt: "15M CONT. REINFORCEMENT @ TOP OF BRICK LEDGE",
      },
      linked_item: {
        id: "item-brick",
        description: "brick ledge",
        bar_size: "10M",
        quantity_count: 0,
        total_length: 0,
        total_weight: 0,
        missing_refs: ["rebar_callout", "element_dimensions"],
      },
    };
    const row: WorkflowTakeoffRow = {
      id: "legacy:item-brick",
      raw_id: "item-brick",
      raw_kind: "legacy",
      mark: "M011",
      size: "10M",
      shape: "brick ledge",
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

    const result = buildFinishEstimationAgentResponse({
      files: [],
      qaIssues: [issue],
      takeoffRows: [row],
      extractionAudit: null,
    });

    expect(result.content).toContain("Blocked Row Findings");
    expect(result.content).toContain("M011");
    expect(result.content).toContain("Brick ledge dimensions per detail");
    expect(result.suggestion?.issueId).toBe("legacy:issue-brick");
    expect(result.suggestion?.answerText).toContain("115mm");
  });

  it("moves to the next estimation suggestion after skipping an applied issue", () => {
    const brickIssue: WorkflowQaIssue = {
      id: "legacy:issue-brick",
      title: "P17: brick ledge",
      description: "Look at P17. Find the brick ledge.",
      severity: "error",
      status: "open",
      issue_type: "unresolved_geometry",
      location_label: "P17",
      location: { page_number: 17, element_reference: "brick ledge", source_excerpt: "15M CONT. REINFORCEMENT @ TOP OF BRICK LEDGE" },
      linked_item: { id: "item-brick", description: "brick ledge", bar_size: "10M", quantity_count: 0, total_length: 0, total_weight: 0, missing_refs: ["rebar_callout", "element_dimensions"] },
    };
    const wallIssue: WorkflowQaIssue = {
      id: "legacy:issue-wall",
      title: "P12: foundation wall",
      description: "Missing wall dimensions.",
      severity: "error",
      status: "open",
      issue_type: "unresolved_geometry",
      location_label: "P12",
      location: { page_number: 12, element_reference: "foundation wall", source_excerpt: 'Continuous horizontal bars @top of foundation wall w/ 800mm (32") hook' },
      linked_item: { id: "item-wall", description: "foundation wall", bar_size: "15M", quantity_count: 0, total_length: 0, total_weight: 0, missing_refs: ["rebar_callout", "element_dimensions"] },
    };

    const result = buildNextEstimationAgentResponse({
      files: [],
      qaIssues: [brickIssue, wallIssue],
      takeoffRows: [],
      extractionAudit: null,
    }, { skipIssueIds: ["legacy:issue-brick"] });

    expect(result.suggestion?.issueId).toBe("legacy:issue-wall");
    expect(result.content).toContain("foundation wall");
  });

  it("does not loop over duplicate answered brick ledge QA issues after apply", () => {
    const brickIssue = (id: string): WorkflowQaIssue => ({
      id,
      title: "P17: brick ledge",
      description: "Look at P17. Find the brick ledge.",
      severity: "error",
      status: "open",
      issue_type: "unresolved_geometry",
      location_label: "P17",
      location: {
        page_number: 17,
        element_reference: "brick ledge",
        source_excerpt: "15M CONT. REINFORCEMENT @ TOP OF BRICK LEDGE",
      },
      linked_item: {
        id: id.replace("issue", "item"),
        description: "brick ledge",
        bar_size: "10M",
        quantity_count: 0,
        total_length: 0,
        total_weight: 0,
        missing_refs: ["rebar_callout", "element_dimensions"],
      },
      source_refs: [{ engineer_answer: { status: "answered", answer_text: "Brick ledge dimensions per detail." } }],
    });
    const wallIssue: WorkflowQaIssue = {
      id: "legacy:issue-wall",
      title: "P12: foundation wall",
      description: "Missing wall dimensions.",
      severity: "error",
      status: "open",
      issue_type: "unresolved_geometry",
      location_label: "P12",
      location: { page_number: 12, element_reference: "foundation wall", source_excerpt: 'Continuous horizontal bars @top of foundation wall w/ 800mm (32") hook' },
      linked_item: { id: "item-wall", description: "foundation wall", bar_size: "15M", quantity_count: 0, total_length: 0, total_weight: 0, missing_refs: ["rebar_callout", "element_dimensions"] },
    };

    const result = buildFinishEstimationAgentResponse({
      files: [],
      qaIssues: [brickIssue("legacy:issue-brick-1"), brickIssue("legacy:issue-brick-2"), brickIssue("legacy:issue-brick-3"), wallIssue],
      takeoffRows: [],
      extractionAudit: null,
    });

    expect(result.content).not.toContain("Brick ledge dimensions per detail");
    expect(result.suggestion?.issueId).toBe("legacy:issue-wall");
    expect(result.content).toContain("1 open QA issue");
  });

  it("deduplicates identical open QA findings and skips the whole duplicate group", () => {
    const makeBrickIssue = (id: string): WorkflowQaIssue => ({
      id,
      title: "P17: brick ledge",
      description: "Look at P17. Find the brick ledge.",
      severity: "error",
      status: "open",
      issue_type: "unresolved_geometry",
      location_label: "P17",
      location: { page_number: 17, element_reference: "brick ledge", source_excerpt: "15M CONT. REINFORCEMENT @ TOP OF BRICK LEDGE" },
      linked_item: { id, description: "brick ledge", bar_size: "10M", quantity_count: 0, total_length: 0, total_weight: 0, missing_refs: ["rebar_callout", "element_dimensions"] },
    });

    const result = buildNextEstimationAgentResponse({
      files: [],
      qaIssues: [makeBrickIssue("legacy:issue-brick-1"), makeBrickIssue("legacy:issue-brick-2")],
      takeoffRows: [],
      extractionAudit: null,
    }, { skipIssueIds: ["legacy:issue-brick-1"] });

    expect(result.suggestion).toBeNull();
    expect(result.content).toContain("No open QA issues found");
  });

  it("groups duplicate blocked row findings instead of listing the same blocker repeatedly", () => {
    const row = (mark: string): WorkflowTakeoffRow => ({
      id: `legacy:${mark}`,
      raw_id: mark,
      raw_kind: "legacy",
      mark,
      size: "10M",
      shape: "115mm (4-1/2\") BRICK LEDGE - 10M VERTICAL",
      count: 0,
      length: 0,
      weight: 0,
      status: "blocked",
      source: "Drawing",
      segment_id: null,
      segment_name: "Walls",
      source_file_id: "file-1",
      page_number: 17,
      geometry_status: "unresolved",
      missing_refs: ["element_dimensions"],
    });

    const result = buildFinishEstimationAgentResponse({
      files: [],
      qaIssues: [],
      takeoffRows: [row("M001"), row("M002")],
      extractionAudit: null,
    });

    expect(result.content).toContain("M001 (M002 duplicate)");
    expect(result.content).not.toContain("- M002:");
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

  it("parses wall length, height, and spacing into Canadian quantity and weight", () => {
    expect(parseAssistantAnswerValues("Wall length 12400mm; wall height 3000mm; rebar 15M @ 406mm O.C. vertical")).toMatchObject({
      barSize: "15M",
      quantity: 31,
      totalLengthM: 93,
      weightKg: 146.01,
    });
  });

  it("parses brick ledge vertical bars into Canadian quantity and weight", () => {
    expect(parseAssistantAnswerValues('Brick ledge length 10000mm; bar height 1200mm; 10M vertical bars @ 300mm O.C. typical')).toMatchObject({
      barSize: "10M",
      quantity: 34,
      totalLengthM: 40.8,
      weightKg: 32.03,
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

  it("keeps linked estimate item partial when only bar callout is confirmed", async () => {
    const calls: Array<{ table: string; update: Record<string, unknown>; id?: string }> = [];
    const from = vi.fn((table: string) => {
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: string) => {
          if (column === "id") query.id = value;
          return query;
        }),
        maybeSingle: vi.fn(() => Promise.resolve({
          data: table === "validation_issues"
            ? { source_refs: [{ estimate_item_id: "item-1" }] }
            : { id: "item-1", assumptions_json: { geometry_status: "unresolved", missing_refs: ["element_dimensions"] }, bar_size: null },
          error: null,
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          calls.push({ table, update: patch, id: query.id });
          return { eq: vi.fn(() => Promise.resolve({ error: null })) };
        }),
      };
      return query;
    });
    const supabase = { from } as any;
    const suggestion: AssistantSuggestion = {
      issueId: "legacy:issue-2",
      issueTitle: "P17: brick ledge",
      locationLabel: "P17",
      linkedEstimateItemId: "item-1",
      question: "Question",
      answerText: 'Found: brick ledge; bar callout 10M vertical bars @ 300mm O.C. typical. Please confirm dimensions.',
      confidence: "medium",
      needsConfirmation: true,
      structuredValues: { bar_callout: "10M vertical bars @ 300mm O.C. typical" },
      missingRefs: ["element_dimensions"],
    };

    const result = await applyAssistantSuggestion(supabase, suggestion, suggestion.answerText, "resolved");

    expect(result.estimateUpdated).toBe(true);
    const itemPatch = calls.find((call) => call.table === "estimate_items")?.update;
    expect(itemPatch).toMatchObject({ bar_size: "10M" });
    expect(itemPatch).not.toHaveProperty("quantity_count");
    expect((itemPatch?.assumptions_json as Record<string, unknown>).geometry_status).toBe("partial");
  });
});
