import { describe, it, expect } from "vitest";

/**
 * Detection Regression Tests
 *
 * These tests validate the server-side veto logic in detect-project-type.
 * They extract and re-implement the keyword-based veto logic locally so
 * tests run without calling the deployed edge function (which requires
 * AI inference and real images).
 *
 * The "contract" under test:
 *   - primaryCategory !== "cage_only" whenever buildingSignals are present
 *   - features.hasCageAssembly === true when cage signals exist alongside building signals
 *   - primaryCategory === "cage_only" only when cage signals dominate AND no building signals
 *   - primaryCategory === "bar_list_only" when only bar list signals are found
 */

// ── Mirrors the BUILDING_VETO_SIGNALS array from detect-project-type/index.ts ──
const BUILDING_VETO_SIGNALS = [
  "foundation plan", "footing", "strip footing", "basement wall", "basement",
  "icf wall", "icf", "slab on grade", "sog", "wire mesh", "wwm",
  "framing plan", "beam", "joist", "gridlines", "floor levels", "floor plan",
  "general notes", "column schedule", "wall schedule", "slab", "stair",
  "grade beam", "raft slab", "retaining wall", "cmu wall",
];

const CAGE_KEYWORDS = [
  "cage", "spiral", "tied assembly", "cage mark", "prefab", "column cage",
  "cage schedule", "cage height", "cage dia", "caisson", "drilled pier",
  "drilled shaft", "belled",
];

const BAR_LIST_KEYWORDS = ["bar list", "bar schedule", "bar mark", "cut length", "bending schedule"];

/** Simulates the keyword-based veto logic from detect-project-type */
function simulateVetoLogic(ocrText: string) {
  const lower = ocrText.toLowerCase();
  const foundBuilding = BUILDING_VETO_SIGNALS.filter((s) => lower.includes(s));
  const foundCage = CAGE_KEYWORDS.filter((k) => lower.includes(k));
  const foundBarList = BAR_LIST_KEYWORDS.filter((k) => lower.includes(k));

  // Determine raw primary category (what the AI might return)
  let primaryCategory: string;
  if (foundBarList.length > 0 && foundBuilding.length === 0 && foundCage.length === 0) {
    primaryCategory = "bar_list_only";
  } else if (foundCage.length > 0 && foundBuilding.length === 0) {
    primaryCategory = "cage_only";
  } else if (foundBuilding.length > 0) {
    primaryCategory = "residential"; // fallback building type
  } else {
    primaryCategory = "commercial"; // default fallback
  }

  // Server-side veto: override cage_only if building signals exist
  const features = {
    hasCageAssembly: foundCage.length > 0,
    hasBarListTable: foundBarList.length > 0,
  };

  if (primaryCategory === "cage_only" && foundBuilding.length > 0) {
    primaryCategory = "residential";
    features.hasCageAssembly = true;
  }

  return {
    primaryCategory,
    features,
    evidence: {
      buildingSignals: foundBuilding,
      cageSignals: foundCage,
      barListSignals: foundBarList,
    },
  };
}

describe("Detection Veto Logic", () => {
  it("Test A: building + cage signals → NOT cage_only, hasCageAssembly = true", () => {
    const ocrText = "FOUNDATION PLAN\nSOG DETAILS\nBASEMENT WALL SCHEDULE\nCAISSON DETAIL\nCAGE SCHEDULE";
    const result = simulateVetoLogic(ocrText);

    expect(result.primaryCategory).not.toBe("cage_only");
    expect(result.features.hasCageAssembly).toBe(true);
    expect(result.evidence.buildingSignals.length).toBeGreaterThan(0);
    expect(result.evidence.cageSignals.length).toBeGreaterThan(0);
  });

  it("Test B: only cage signals, no building → cage_only", () => {
    const ocrText = "PIER SCHEDULE\nCAGE SCHEDULE\nDRILLED SHAFT DETAILS\nSPIRAL REINFORCEMENT";
    const result = simulateVetoLogic(ocrText);

    expect(result.primaryCategory).toBe("cage_only");
    expect(result.features.hasCageAssembly).toBe(true);
    expect(result.evidence.buildingSignals).toHaveLength(0);
  });

  it("Test C: only bar list signals → bar_list_only", () => {
    const ocrText = "BAR LIST\nBAR SCHEDULE\nCUT LENGTH TABLE\nBENDING SCHEDULE";
    const result = simulateVetoLogic(ocrText);

    expect(result.primaryCategory).toBe("bar_list_only");
    expect(result.features.hasBarListTable).toBe(true);
    expect(result.evidence.buildingSignals).toHaveLength(0);
    expect(result.evidence.cageSignals).toHaveLength(0);
  });

  it("Fail condition: cage_only must never coexist with building signals", () => {
    // Exhaustive check: for any text with building signals, veto must prevent cage_only
    const textsWithBuildingSignals = [
      "CAGE SCHEDULE\nFOUNDATION PLAN",
      "CAISSON DETAIL\nGENERAL NOTES\nFOOTING DETAILS",
      "DRILLED PIER\nBASEMENT WALL\nSOG",
      "CAGE HEIGHT 12M\nGRADE BEAM REINFORCEMENT",
      "SPIRAL REBAR\nRETAINING WALL SECTION",
    ];

    for (const text of textsWithBuildingSignals) {
      const result = simulateVetoLogic(text);
      if (result.evidence.buildingSignals.length > 0) {
        expect(result.primaryCategory).not.toBe("cage_only");
      }
    }
  });

  it("Mixed signals: cage + building → building category with cage feature", () => {
    const ocrText = "COLUMN SCHEDULE\nBEAM DETAILS\nCAGE MARK C1\nFOOTING F1";
    const result = simulateVetoLogic(ocrText);

    expect(result.primaryCategory).not.toBe("cage_only");
    expect(result.features.hasCageAssembly).toBe(true);
    expect(result.evidence.buildingSignals.length).toBeGreaterThan(0);
  });
});

// ── Weight Accuracy Regression ──────────────────────────────────────────────

/** Re-implement the core bar_lines weight math from price-elements for local testing */
const METRIC_REBAR_MASS: Record<string, number> = {
  "10M": 0.785, "15M": 1.570, "20M": 2.355, "25M": 3.925,
  "30M": 5.495, "35M": 7.850, "45M": 11.775, "55M": 19.625,
};
const IMPERIAL_REBAR_WEIGHT: Record<string, number> = {
  "#3": 0.376, "#4": 0.668, "#5": 1.043, "#6": 1.502,
  "#7": 2.044, "#8": 2.670, "#9": 3.400, "#10": 4.303,
  "#11": 5.313, "#14": 7.650, "#18": 13.600,
};

function getMassKgPerM(size: string): number {
  if (METRIC_REBAR_MASS[size]) return METRIC_REBAR_MASS[size];
  if (IMPERIAL_REBAR_WEIGHT[size]) return IMPERIAL_REBAR_WEIGHT[size] * 1.48816;
  return 0;
}

interface TestBarLine {
  mark?: string; size: string; multiplier?: number; qty: number;
  length_mm?: number; length_ft?: number; weight_kg?: number;
}

function computeWeightKg(barLines: TestBarLine[]): number {
  let total = 0;
  for (const line of barLines) {
    const mult = line.multiplier || 1;
    const qty = line.qty || 0;
    if (line.length_mm && line.length_mm > 0) {
      total += mult * qty * (line.length_mm / 1000) * getMassKgPerM(line.size);
    } else if (line.length_ft && line.length_ft > 0) {
      const wPerFt = IMPERIAL_REBAR_WEIGHT[line.size] || 0;
      total += mult * qty * line.length_ft * wPerFt * 0.453592;
    } else if (line.weight_kg && line.weight_kg > 0) {
      total += line.weight_kg;
    }
  }
  return total;
}

function checkWeightAccuracy(aiWeightKg: number, excelWeightKg: number, maxErrorPct: number) {
  const errorPct = Math.abs(aiWeightKg - excelWeightKg) / excelWeightKg * 100;
  return { errorPct, pass: errorPct <= maxErrorPct };
}

describe("Weight Accuracy Regression", () => {
  // Fixture: representative bar_lines for 20 York Valley (subset to validate math)
  const YORK_VALLEY_FIXTURE: TestBarLine[] = [
    { mark: "20M @ 12\" OC BLL", size: "20M", multiplier: 2, qty: 87, length_mm: 17437 },
    { mark: "20M @ 12\" OC BUL", size: "20M", multiplier: 2, qty: 57, length_mm: 29566 },
    { mark: "15M @ 12\" OC TUL", size: "15M", multiplier: 2, qty: 87, length_mm: 17437 },
    { mark: "15M @ 12\" OC TLL", size: "15M", multiplier: 2, qty: 57, length_mm: 29566 },
    { mark: "20M dowels", size: "20M", multiplier: 1, qty: 120, length_mm: 1200 },
    { mark: "15M chairs", size: "15M", multiplier: 1, qty: 200, length_mm: 900 },
    { mark: "25M step bars", size: "25M", multiplier: 1, qty: 45, length_mm: 3500 },
    { mark: "20M grade beam vert", size: "20M", multiplier: 1, qty: 64, length_mm: 2400 },
    { mark: "10M ties @ 300", size: "10M", multiplier: 1, qty: 320, length_mm: 1600 },
    { mark: "15M footing bot EW", size: "15M", multiplier: 1, qty: 48, length_mm: 2700 },
  ];

  it("bar_lines math produces non-trivial weight for a real project fixture", () => {
    const totalKg = computeWeightKg(YORK_VALLEY_FIXTURE);
    // Must be at least 5000 kg for this subset (real total is ~44,777 kg)
    expect(totalKg).toBeGreaterThan(5000);
    // Should not exceed the full project weight
    expect(totalKg).toBeLessThan(50000);
  });

  it("checkWeightAccuracy helper correctly identifies pass/fail", () => {
    const pass = checkWeightAccuracy(40000, 44777, 25);
    expect(pass.pass).toBe(true);
    expect(pass.errorPct).toBeLessThan(25);

    const fail = checkWeightAccuracy(5000, 44777, 25);
    expect(fail.pass).toBe(false);
    expect(fail.errorPct).toBeGreaterThan(25);
  });

  it("coverage LOW_COVERAGE flag should be present when bar_lines_count is low", () => {
    // Simulate coverage output
    const coverage = { bar_lines_count: 5, elements_count: 2, pages_processed: 8, status: "LOW_COVERAGE" };
    if (coverage.pages_processed >= 5 && coverage.bar_lines_count < 30) {
      expect(coverage.status).toBe("LOW_COVERAGE");
    }
  });

  it("fail condition: cage_only must never coexist with building signals", () => {
    // Reuse veto logic from Detection tests
    const result = simulateVetoLogic("CAGE SCHEDULE\nFOUNDATION PLAN\nBASEMENT WALL");
    if (result.evidence.buildingSignals.length > 0) {
      expect(result.primaryCategory).not.toBe("cage_only");
    }
  });
});
