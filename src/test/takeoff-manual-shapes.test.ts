import { describe, expect, it } from "vitest";
import { createCirclePolygon, createManualShapePolygon, createSquarePolygon } from "@/lib/takeoff-manual-shapes";

describe("takeoff manual shapes", () => {
  it("creates a clamped square around center", () => {
    const square = createSquarePolygon(0.01, 0.01, 0.05);
    expect(square[0]).toEqual([0, 0]);
    expect(square[1][0]).toBeCloseTo(0.06);
    expect(square[1][1]).toBe(0);
    expect(square[2][0]).toBeCloseTo(0.06);
    expect(square[2][1]).toBeCloseTo(0.06);
    expect(square[3][0]).toBe(0);
    expect(square[3][1]).toBeCloseTo(0.06);
  });

  it("creates circle polygon with expected side count", () => {
    const circle = createCirclePolygon(0.5, 0.5, 0.1, 12);
    expect(circle).toHaveLength(12);
    for (const [x, y] of circle) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it("dispatches shape creation by tool", () => {
    expect(createManualShapePolygon("square", 0.5, 0.5)).toHaveLength(4);
    expect(createManualShapePolygon("circle", 0.5, 0.5)).toHaveLength(20);
  });
});
