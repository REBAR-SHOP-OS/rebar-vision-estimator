import { describe, expect, it } from "vitest";
import { resolveScale } from "@/features/workflow-v2/lib/scale-resolver";

describe("resolveScale", () => {
  it("detects a clear sheet scale even when it appears after the OCR beginning", () => {
    const rawText = `${"A".repeat(13000)} FOUNDATION PLAN SCALE: 1/8" = 1'-0" ${"B".repeat(13000)}`;
    const cal = resolveScale({ rawText, discipline: "Structural" });
    expect(cal).not.toBeNull();
    expect(cal?.pixelsPerFoot).toBeGreaterThan(0);
    expect(cal?.reviewState).toBe("auto-detected");
    expect(cal?.diagnostics?.scannedSegments).toEqual(["start", "middle", "end"]);
  });

  it("flags ambiguous when multiple competing sheet scales are found", () => {
    const cal = resolveScale({
      rawText: "FOUNDATION PLAN SCALE: 1/8\" = 1'-0\" ROOF PLAN SCALE: 1/4\" = 1'-0\"",
    });
    expect(cal?.reviewState).toBe("ambiguous");
    expect(cal?.reason).toBe("multiple scales detected");
    expect(cal?.pixelsPerFoot).toBe(0);
  });

  it("flags detail-only scales as ambiguous instead of auto-resolving", () => {
    const cal = resolveScale({
      rawText: "DETAIL A SCALE: 1:20 DETAIL B SCALE: 1:10",
      discipline: "Structural",
    });
    expect(cal?.reviewState).toBe("ambiguous");
    expect(cal?.reason).toBe("detail scales found only");
  });

  it("does not apply a default fallback scale when no usable text exists", () => {
    const cal = resolveScale({ rawText: "General notes and legends only. No dimensions. ".repeat(8) });
    expect(cal?.pixelsPerFoot).toBe(0);
    expect(cal?.reviewState).toBe("failed");
    expect(cal?.reason).toBe("no scale text found");
  });
});
