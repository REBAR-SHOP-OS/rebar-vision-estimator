import { describe, expect, it } from "vitest";
import { DEFAULT_MARK_PATTERNS, extractMarkCandidates, markBucket, normalizeMarkToken } from "@/lib/ocr-page-labels";

describe("ocr-page-labels token handling", () => {
  it("normalizes OCR punctuation/noise around marks", () => {
    expect(normalizeMarkToken(" wf–12a) ")).toBe("WF-12A");
    expect(normalizeMarkToken("  [f.3]  ")).toBe("F.3");
  });

  it("extracts candidate tokens from mixed OCR text", () => {
    expect(extractMarkCandidates("SECT: WF-2A / F.3, P1; C-9")).toEqual([
      "SECT:WF-2A/F.3,P1;C-9",
      "SECT",
      "WF-2A",
      "F.3",
      "P1",
      "C-9",
    ]);
  });

  it("keeps expected bucket classification for normalized tokens", () => {
    expect(markBucket(" WF-2A ")).toBe("wall");
    expect(markBucket("F.3")).toBe("footing");
    expect(markBucket("P1")).toBe("pier");
    expect(markBucket("C-9")).toBe("column");
  });

  it("default patterns still match normalized structural marks", () => {
    const tokens = ["WF-2A", "F.3", "P1", "C-9"];
    for (const token of tokens) {
      expect(DEFAULT_MARK_PATTERNS.some((p) => p.test(token))).toBe(true);
    }
  });
});
