import { describe, expect, it } from "vitest";
import { checkConcreteRebar } from "@/lib/validation/concrete-rebar-gate";

describe("checkConcreteRebar", () => {
  it("flags MISSING_REBAR when concrete keyword appears with no matching estimate row", () => {
    const issues = checkConcreteRebar({
      ocrText: "FOOTING F1 1200x1200x300 / WALL W3 8 HIGH",
      estimateRows: [{ description: "WALL W3 vertical bars" }],
    });
    expect(issues.map((i) => i.family)).toContain("FOOTING");
    expect(issues.map((i) => i.family)).not.toContain("WALL");
  });

  it("returns no issues when every concrete family has at least one rebar line", () => {
    const issues = checkConcreteRebar({
      ocrText: "FOOTING F1 / WALL W1",
      estimateRows: [
        { description: "FOOTING F1 — 15M @ 250 BEW" },
        { description: "WALL W1 — 15M @ 406 D/V" },
      ],
    });
    expect(issues).toEqual([]);
  });
});