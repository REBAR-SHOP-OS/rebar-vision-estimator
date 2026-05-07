import { describe, expect, it } from "vitest";
import { buildEngineerQuestion, inferEngineerAnswerFields, summarizeEngineerAnswer } from "@/features/workflow-v2/stages/qa-answer-fields";

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
    })).toBe('On P15, find the C.I.P. concrete leveling pad into foundation wall. The callout requires 400mm (16") long 10M dowels at 300mm (12") O.C. What is the full leveling pad run length, and how many dowels are required?');
  });
});
