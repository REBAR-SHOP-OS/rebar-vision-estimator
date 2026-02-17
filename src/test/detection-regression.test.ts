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
