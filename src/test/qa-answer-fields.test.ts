import { describe, expect, it } from "vitest";
import { buildEngineerAnswerDraft, buildEngineerQuestion, inferEngineerAnswerFields, summarizeEngineerAnswer } from "@/features/workflow-v2/stages/qa-answer-fields";

describe("qa answer fields", () => {
  it("asks for length and bar callout from unresolved geometry text", () => {
    const fields = inferEngineerAnswerFields(
      ["rebar_callout", "element_dimensions"],
      "Enter the dimensions and bar callout from the drawing.",
    ).map((field) => field.key);

    expect(fields).toContain("length");
    expect(fields).toContain("bar_callout");
    expect(fields).toContain("notes");
  });

  it("falls back to a generic answer when no specific field is implied", () => {
    expect(inferEngineerAnswerFields([], "Check the source.").map((field) => field.key)).toEqual(["answer", "notes"]);
  });

  it("summarizes non-empty values for storage", () => {
    expect(summarizeEngineerAnswer({ length: "3000mm", notes: "", bar_callout: "15M @ 406mm O.C." }))
      .toBe("Length: 3000mm; Bar callout: 15M @ 406mm O.C.");
  });

  it("builds an on-point free response question", () => {
    expect(buildEngineerQuestion({
      locationLabel: "P15-T.D.69",
      objectIdentity: "leveling pad",
      missingRefs: ["element_dimensions"],
      sourceExcerpt: "LEVELING PAD INTO FOUNDATION WALL",
    })).toBe('On P15-T.D.69, find the leveling pad. What length should be used for this item? Use the callout/excerpt "LEVELING PAD INTO FOUNDATION WALL".');
  });

  it("asks for run length and dowel count from leveling pad dowel callouts", () => {
    const excerpt = 'PROVIDE 400mm (16") LONG 10M DOWELS AT 300mm (12") O.C. FROM C.I.P. CONC. LEVELING PAD INTO FOUNDATION WALL';
    const fields = inferEngineerAnswerFields(["rebar_callout", "element_dimensions"], excerpt).map((field) => field.key);

    expect(fields).toEqual(["length", "quantity", "bar_callout", "notes"]);
    expect(buildEngineerQuestion({
      locationLabel: "P15",
      objectIdentity: "leveling pad",
      missingRefs: ["rebar_callout", "element_dimensions"],
      sourceExcerpt: excerpt,
    })).toBe('On P15, find the C.I.P. concrete leveling pad into foundation wall. The callout requires 400mm (16") long 10M dowels @ 300mm (12") O.C. What is the full leveling pad run length, and how many dowels are required?');
  });

  it("drafts a confirmation answer when dowel callout is found without run length", () => {
    const excerpt = 'PROVIDE 400mm (16") LONG 10M DOWELS AT 300mm (12") O.C. FROM C.I.P. CONC. LEVELING PAD INTO FOUNDATION WALL';
    const draft = buildEngineerAnswerDraft({
      locationLabel: "P15",
      missingRefs: ["rebar_callout", "element_dimensions"],
      sourceExcerpt: excerpt,
    });

    expect(draft.confidence).toBe("medium");
    expect(draft.needsConfirmation).toBe(true);
    expect(draft.structuredValues).toEqual({ bar_callout: '400mm (16") long 10M dowels @ 300mm (12") O.C.' });
    expect(draft.draftAnswer).toBe('Found: 400mm (16") long 10M dowels @ 300mm (12") O.C. from C.I.P. concrete leveling pad into foundation wall. Please confirm the full leveling pad run length so dowel quantity can be calculated.');
  });

  it("calculates dowel quantity when reliable run length is present", () => {
    const excerpt = 'PROVIDE 400mm (16") LONG 10M DOWELS AT 300mm (12") O.C. FROM C.I.P. CONC. LEVELING PAD INTO FOUNDATION WALL';
    const draft = buildEngineerAnswerDraft({
      locationLabel: "P15",
      description: "Leveling pad run length 10000mm.",
      missingRefs: ["rebar_callout", "element_dimensions"],
      sourceExcerpt: excerpt,
    });

    expect(draft.confidence).toBe("high");
    expect(draft.structuredValues).toEqual({
      bar_callout: '400mm (16") long 10M dowels @ 300mm (12") O.C.',
      length: "10000mm",
      quantity: "34",
    });
    expect(draft.draftAnswer).toBe('Found: run length 10000mm; use 400mm (16") long 10M dowels @ 300mm (12") O.C.; quantity = 34 dowels. Please confirm.');
  });

  it("drafts an intelligent answer from frost slab rebar callouts", () => {
    const excerpt = "152mm FROST SLAB W/ 15M @ 305mm O.C. EACH WAY IN THE CENTRE OF SLAB.";
    const fields = inferEngineerAnswerFields(["rebar_callout", "element_dimensions"], excerpt).map((field) => field.key);
    const draft = buildEngineerAnswerDraft({
      locationLabel: "P12",
      missingRefs: ["rebar_callout", "element_dimensions"],
      sourceExcerpt: excerpt,
    });

    expect(fields).toContain("thickness");
    expect(fields).toContain("bar_callout");
    expect(draft.question).toBe("On P12, find the frost slab. The drawing shows 152mm frost slab with 15M @ 305mm O.C. each way in the centre of slab. What slab length and width should be used?");
    expect(draft.draftAnswer).toBe("Found: 152mm frost slab; rebar 15M @ 305mm O.C. each way in the centre of slab. Please confirm the slab length and width.");
    expect(draft.structuredValues).toEqual({
      thickness: "152mm",
      bar_callout: "15M @ 305mm O.C. each way",
      notes: "in the centre of slab",
    });
  });

  it("drafts visible wall callouts but still asks for missing dimensions", () => {
    const draft = buildEngineerAnswerDraft({
      locationLabel: "P6",
      missingRefs: ["element_dimensions"],
      sourceExcerpt: "203mm FOUNDATION WALL W/ 15M @ 406mm O.C. MIDDLE EACH WAY.",
    });

    expect(draft.question).toContain("find the foundation wall");
    expect(draft.question).toContain("wall length and height");
    expect(draft.draftAnswer).toContain("Found: 203mm foundation wall; rebar 15M @ 406mm O.C.");
    expect(draft.structuredValues.thickness).toBe("203mm");
  });

  it("drafts suggestions from descriptive foundation wall hook callouts", () => {
    const excerpt = 'Continuous horizontal bars @top of foundation wall w/ 800mm (32") hook';
    const fields = inferEngineerAnswerFields(["rebar_callout", "element_dimensions"], excerpt).map((field) => field.key);
    const draft = buildEngineerAnswerDraft({
      locationLabel: "P12",
      objectIdentity: "foundation wall",
      missingRefs: ["rebar_callout", "element_dimensions"],
      sourceExcerpt: excerpt,
    });

    expect(fields).toContain("bar_callout");
    expect(draft.question).toBe('On P12, find the foundation wall. The drawing shows foundation wall with continuous horizontal bars at top of foundation wall with 800mm (32") hook. What wall length and height should be used?');
    expect(draft.draftAnswer).toBe('Found: foundation wall; rebar continuous horizontal bars at top of foundation wall with 800mm (32") hook. Please confirm the wall length and height.');
    expect(draft.structuredValues).toEqual({
      bar_callout: 'continuous horizontal bars at top of foundation wall with 800mm (32") hook',
    });
  });

  it("does not draft an answer from unrelated descriptive text", () => {
    const draft = buildEngineerAnswerDraft({
      locationLabel: "P2",
      sourceExcerpt: "Refer to architectural drawings for information.",
    });

    expect(draft.draftAnswer).toBe("");
    expect(draft.structuredValues).toEqual({});
  });
});
