import { describe, expect, it } from "vitest";
import { parseScaleRatio, resolveWallGeometryFromPages } from "@/lib/wall-geometry-resolver";

describe("wall geometry resolver", () => {
  it("finds wall length and height from explicit OCR text", () => {
    const result = resolveWallGeometryFromPages({
      pages: [{
        pageNumber: 10,
        sheetTag: "S-1.0",
        discipline: "structural",
        rawText: "FOUNDATION PLAN. FOUNDATION WALL. Wall length 12400mm. Wall height 3000mm. 15M @ 406mm O.C.",
      }],
      calloutText: "15M @ 406mm O.C.",
    });

    expect(result).toMatchObject({
      lengthMm: 12400,
      heightMm: 3000,
      method: "explicit_text",
      confidence: "high",
      needsConfirmation: false,
    });
  });

  it("finds wall dimensions from schedule-style rows", () => {
    const result = resolveWallGeometryFromPages({
      pages: [{
        pageNumber: 4,
        sheetTag: "S-2.0",
        discipline: "structural",
        rawText: "FOUNDATION WALL SCHEDULE W3 FOUNDATION WALL 18600 x 3200 15M @ 300 O.C.",
      }],
      objectText: "foundation wall W3",
    });

    expect(result.lengthMm).toBe(18600);
    expect(result.heightMm).toBe(3200);
    expect(result.method).toBe("schedule");
  });

  it("uses scale measurement only when scale and bbox are reliable", () => {
    const result = resolveWallGeometryFromPages({
      pages: [{
        pageNumber: 2,
        sheetTag: "S-1.0",
        discipline: "structural",
        rawText: "FOUNDATION PLAN FOUNDATION WALL GRID A3",
        scaleRaw: "1:50",
        bbox: [10, 20, 210, 30],
      }],
      objectText: "foundation wall",
    });

    expect(result.lengthMm).toBe(10000);
    expect(result.method).toBe("scale_measurement");
    expect(result.needsConfirmation).toBe(true);
  });

  it("rejects scale measurement without reliable wall extents", () => {
    const result = resolveWallGeometryFromPages({
      pages: [{
        pageNumber: 2,
        sheetTag: "S-1.0",
        discipline: "structural",
        rawText: "FOUNDATION PLAN FOUNDATION WALL GRID A3",
        scaleRaw: "1:50",
        bbox: [10, 20, 15, 21],
      }],
      objectText: "foundation wall",
    });

    expect(result.method).toBe("not_found");
    expect(result.lengthMm).toBeNull();
  });

  it("parses common Canadian sheet scales", () => {
    expect(parseScaleRatio("1:50")).toBe(50);
    expect(parseScaleRatio("1mm = 0.05m")).toBe(50);
  });
});
