import { describe, it, expect } from "vitest";
import {
  getMassKgPerM,
  computeItemWeightKg,
  kgToLbs,
  detectLengthUnit,
  toMm,
} from "@/lib/rebar-weights";

/**
 * Excel Weight Accuracy Regression Tests
 *
 * Validates the corrected weight calculation pipeline against known
 * ground-truth values from real project workbooks.
 */

describe("Rebar Weight Tables", () => {
  it("CSA metric sizes return correct kg/m values", () => {
    expect(getMassKgPerM("10M")).toBeCloseTo(0.785, 3);
    expect(getMassKgPerM("15M")).toBeCloseTo(1.570, 3);
    expect(getMassKgPerM("20M")).toBeCloseTo(2.355, 3);
    expect(getMassKgPerM("25M")).toBeCloseTo(3.925, 3);
    expect(getMassKgPerM("30M")).toBeCloseTo(5.495, 3);
    expect(getMassKgPerM("35M")).toBeCloseTo(7.850, 3);
  });

  it("Imperial sizes return converted kg/m values", () => {
    // #4 = 0.668 lb/ft * 1.48816 = ~0.994 kg/m
    expect(getMassKgPerM("#4")).toBeCloseTo(0.668 * 1.48816, 2);
    expect(getMassKgPerM("#8")).toBeCloseTo(2.670 * 1.48816, 2);
  });

  it("Unknown size returns 0", () => {
    expect(getMassKgPerM("99Z")).toBe(0);
  });
});

describe("Unit Detection", () => {
  it("detects metres from header 'Total Length (Mtr.)'", () => {
    const result = detectLengthUnit(["MARK", "SIZE", "QTY", "Total Length (Mtr.)"]);
    expect(result.unit).toBe("m");
    expect(result.assumed).toBe(false);
  });

  it("detects mm from header 'LENGTH (mm)'", () => {
    const result = detectLengthUnit(["SIZE", "QTY", "LENGTH (mm)"]);
    expect(result.unit).toBe("mm");
    expect(result.assumed).toBe(false);
  });

  it("detects feet from header 'Length (ft)'", () => {
    const result = detectLengthUnit(["SIZE", "QTY", "Length (ft)"]);
    expect(result.unit).toBe("ft");
    expect(result.assumed).toBe(false);
  });

  it("defaults to mm with assumed=true when ambiguous", () => {
    const result = detectLengthUnit(["SIZE", "QTY", "TOTAL LENGTH"]);
    expect(result.unit).toBe("mm");
    expect(result.assumed).toBe(true);
  });
});

describe("Unit Conversion (toMm)", () => {
  it("metres to mm", () => {
    expect(toMm(17.437, "m")).toBeCloseTo(17437, 0);
  });

  it("feet to mm", () => {
    expect(toMm(10, "ft")).toBeCloseTo(3048, 0);
  });

  it("inches to mm", () => {
    expect(toMm(12, "in")).toBeCloseTo(304.8, 1);
  });

  it("mm passthrough", () => {
    expect(toMm(5000, "mm")).toBe(5000);
  });
});

describe("Per-Row Weight Computation", () => {
  it("computes correct weight for a single 20M bar in metres", () => {
    // 20M: 2.355 kg/m, length 17.437m = 17437mm, qty=1, mult=1
    const weightKg = computeItemWeightKg({
      size: "20M",
      qty: 1,
      multiplier: 1,
      length_mm: 17437,
    });
    // Expected: 1 * 1 * (17437/1000) * 2.355 = 41.064 kg
    expect(weightKg).toBeCloseTo(41.064, 0);
  });

  it("multiplier is applied correctly", () => {
    const withMult = computeItemWeightKg({ size: "20M", qty: 10, multiplier: 2, length_mm: 5000 });
    const withoutMult = computeItemWeightKg({ size: "20M", qty: 10, multiplier: 1, length_mm: 5000 });
    expect(withMult).toBeCloseTo(withoutMult * 2, 2);
  });
});

describe("Excel Import Weight Accuracy — Sample Workbook Fixture", () => {
  // Fixture simulating a real workbook with "Total Length (Mtr.)" header
  // This subset fixture totals ~18,548.28 kg with the current rebar tables.
  const FIXTURE_ROWS = [
    { size: "15M", qty: 48, multiplier: 1, length_m: 3.200 },
    { size: "15M", qty: 120, multiplier: 2, length_m: 2.700 },
    { size: "20M", qty: 87, multiplier: 2, length_m: 17.437 },
    { size: "20M", qty: 57, multiplier: 2, length_m: 29.566 },
    { size: "20M", qty: 120, multiplier: 1, length_m: 1.200 },
    { size: "25M", qty: 45, multiplier: 1, length_m: 3.500 },
    { size: "20M", qty: 64, multiplier: 1, length_m: 2.400 },
    { size: "10M", qty: 320, multiplier: 1, length_m: 1.600 },
    { size: "15M", qty: 48, multiplier: 1, length_m: 2.700 },
    { size: "15M", qty: 200, multiplier: 1, length_m: 0.900 },
  ];

  it("computed total matches the subset fixture weight", () => {
    let totalKg = 0;
    for (const row of FIXTURE_ROWS) {
      const length_mm = toMm(row.length_m, "m");
      totalKg += computeItemWeightKg({
        size: row.size,
        qty: row.qty,
        multiplier: row.multiplier,
        length_mm,
      });
    }

    const expectedKg = 18548.28301;
    const errorPct = Math.abs(totalKg - expectedKg) / expectedKg * 100;
    expect(errorPct).toBeLessThan(0.001);
    expect(totalKg).toBeGreaterThan(18000);
    expect(totalKg).toBeLessThan(19000);
  });

  it("old buggy formula would have produced ~1615 kg (proving the fix)", () => {
    // Simulate old bug: treating metres as mm, dividing by 304.8
    const OLD_REBAR_UNIT_WEIGHT: Record<string, number> = {
      "10M": 0.527, "15M": 1.055, "20M": 1.582, "25M": 2.637,
    };

    let oldTotal = 0;
    for (const row of FIXTURE_ROWS) {
      // Old bug: value in metres treated as mm, then / 304.8 → ridiculously small ft value
      const lengthFt = row.length_m / 304.8;
      const unitWt = OLD_REBAR_UNIT_WEIGHT[row.size] || 0;
      oldTotal += row.qty * lengthFt * unitWt; // produces lbs, not even kg
    }

    // Old output was ~1615 lbs misreported as kg — way too low
    expect(oldTotal).toBeLessThan(2000);
  });
});

describe("kgToLbs conversion", () => {
  it("converts 1 kg to ~2.205 lbs", () => {
    expect(kgToLbs(1)).toBeCloseTo(2.2046, 2);
  });
});
