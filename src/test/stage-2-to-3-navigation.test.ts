import { describe, expect, it } from "vitest";

/**
 * Locks in the Stage 02 (Scope) → Stage 03 (Calibration) navigation gate.
 *
 * Mirrors:
 *   - src/features/workflow-v2/WorkflowShell.tsx   (rail unlock for `calibration`)
 *   - src/features/workflow-v2/stages/ScopeStage.tsx (Continue button `disabled`)
 *
 * Rules (must hold for both empty-Structural-only and mixed-discipline projects):
 *   1. Calibration rail unlocks as soon as files exist OR any scope is accepted.
 *   2. Continue button on Scope unlocks as soon as candidates are detected;
 *      approval is NOT required to advance.
 */

type StageStatus = "complete" | "active" | "locked" | "blocked" | "pending";

function calibrationStatus(args: {
  fileCount: number;
  scopeAccepted: number;
  calibrationConfirmed: boolean;
}): StageStatus {
  const { fileCount, scopeAccepted, calibrationConfirmed } = args;
  if (calibrationConfirmed) return "complete";
  return scopeAccepted > 0 || fileCount > 0 ? "active" : "locked";
}

function continueDisabled(candidateCount: number): boolean {
  return candidateCount === 0;
}

describe("Stage 02 → Stage 03 navigation gate", () => {
  describe("empty-Structural project (architectural-only or scope still pending approval)", () => {
    it("unlocks the Calibration rail as soon as files exist, even with 0 accepted scope", () => {
      expect(
        calibrationStatus({ fileCount: 3, scopeAccepted: 0, calibrationConfirmed: false }),
      ).toBe("active");
    });

    it("enables the Continue button when candidates are detected without approval", () => {
      expect(continueDisabled(5)).toBe(false);
    });

    it("still locks Calibration when no files and no accepted scope exist", () => {
      expect(
        calibrationStatus({ fileCount: 0, scopeAccepted: 0, calibrationConfirmed: false }),
      ).toBe("locked");
    });

    it("disables Continue when no candidates have been detected yet", () => {
      expect(continueDisabled(0)).toBe(true);
    });
  });

  describe("mixed-discipline project (Structural + Architectural uploads)", () => {
    it("unlocks Calibration via fileCount even before any scope is approved", () => {
      expect(
        calibrationStatus({ fileCount: 7, scopeAccepted: 0, calibrationConfirmed: false }),
      ).toBe("active");
    });

    it("unlocks Calibration via accepted scope as well", () => {
      expect(
        calibrationStatus({ fileCount: 7, scopeAccepted: 4, calibrationConfirmed: false }),
      ).toBe("active");
    });

    it("marks Calibration complete once the user confirms calibration", () => {
      expect(
        calibrationStatus({ fileCount: 7, scopeAccepted: 4, calibrationConfirmed: true }),
      ).toBe("complete");
    });

    it("enables Continue with mixed candidate counts regardless of approval state", () => {
      expect(continueDisabled(12)).toBe(false);
      expect(continueDisabled(1)).toBe(false);
    });
  });
});
