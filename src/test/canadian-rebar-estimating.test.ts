import { describe, expect, it } from "vitest";
import {
  countBarsBySpacing,
  estimateCanadianLine,
  estimateCanadianPadBars,
  footingCutLengthMm,
  parsePieceLengthMm,
  parseSpacingMm,
} from "@/lib/canadian-rebar-estimating";

describe("Canadian rebar estimating rules", () => {
  it("counts bars from distance and spacing plus one", () => {
    expect(countBarsBySpacing(6000, 300)).toBe(21);
    expect(countBarsBySpacing(10000, 300)).toBe(34);
  });

  it("uses RSIC footing cover rule when bar length is not shown", () => {
    expect(footingCutLengthMm(12000)).toBe(11850);
  });

  it("counts pad bars across the opposite direction", () => {
    const result = estimateCanadianPadBars({
      barSize: "15M",
      longDimensionMm: 12000,
      shortDimensionMm: 6000,
      spacingMm: 250,
      footingCoverRule: true,
    });

    expect(result.longBars.quantity).toBe(25);
    expect(result.shortBars.quantity).toBe(49);
    expect(result.longBars.pieceLengthM).toBe(11.85);
    expect(result.shortBars.pieceLengthM).toBe(5.85);
  });

  it("calculates dowel quantity, total length, and Canadian kg weight", () => {
    const result = estimateCanadianLine({
      barSize: "10M",
      runLengthMm: 10000,
      spacingMm: 300,
      pieceLengthMm: 400,
    });

    expect(result.quantity).toBe(34);
    expect(result.totalLengthM).toBe(13.6);
    expect(result.weightKg).toBe(10.68);
  });

  it("does not invent weight when spacing is known but bar cut length is missing", () => {
    const result = estimateCanadianLine({
      barSize: "15M",
      runLengthMm: 6000,
      spacingMm: 300,
    });

    expect(result.quantity).toBe(21);
    expect(result.totalLengthM).toBeNull();
    expect(result.weightKg).toBeNull();
  });

  it("parses CAD callout spacing and piece length", () => {
    const text = '400mm (16") LONG 10M DOWELS AT 300mm (12") O.C.';
    expect(parsePieceLengthMm(text)).toBe(400);
    expect(parseSpacingMm(text)).toBe(300);
  });
});
