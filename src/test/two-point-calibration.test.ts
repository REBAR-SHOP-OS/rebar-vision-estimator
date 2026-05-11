import { describe, it, expect } from "vitest";

/**
 * Pure two-point calibration math, mirroring the formula used inside
 * `TwoPointCalModal` in `CalibrationStage.tsx`.
 *   pixelDist = √((x2-x1)² + (y2-y1)²)
 *   ppf       = pixelDist / realFeet
 */
function computePixelsPerFoot(p1: [number, number], p2: [number, number], realFeet: number): number | null {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  if (!(realFeet > 0) || !(pixelDist > 0)) return null;
  return pixelDist / realFeet;
}

describe("two-point calibration math", () => {
  it("computes px/ft for a horizontal 10 ft span at 96 px/ft", () => {
    const ppf = computePixelsPerFoot([100, 200], [1060, 200], 10);
    expect(ppf).toBeCloseTo(96, 5);
  });

  it("uses Euclidean distance for diagonal spans", () => {
    // 3-4-5 triangle: pixel distance = 5, real = 1 ft → 5 px/ft
    const ppf = computePixelsPerFoot([0, 0], [300, 400], 100);
    expect(ppf).toBeCloseTo(5, 5);
  });

  it("returns null on zero-length picks", () => {
    expect(computePixelsPerFoot([50, 50], [50, 50], 10)).toBeNull();
  });

  it("returns null on non-positive real distance", () => {
    expect(computePixelsPerFoot([0, 0], [100, 0], 0)).toBeNull();
    expect(computePixelsPerFoot([0, 0], [100, 0], -5)).toBeNull();
  });

  it("is independent of point order", () => {
    const a = computePixelsPerFoot([10, 20], [410, 20], 10);
    const b = computePixelsPerFoot([410, 20], [10, 20], 10);
    expect(a).toBeCloseTo(b!, 5);
  });
});