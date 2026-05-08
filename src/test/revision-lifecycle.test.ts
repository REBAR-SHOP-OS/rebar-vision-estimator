import { describe, it, expect } from "vitest";
import {
  findSupersedableRegistryRow,
  findCurrentEstimateVersionId,
} from "@/lib/revision-lifecycle-helpers";

describe("findSupersedableRegistryRow", () => {
  const rows = [
    { id: "r1", file_id: "f1", classification: "structural_pdf", detected_discipline: "Structural", is_active: true },
    { id: "r2", file_id: "f2", classification: "architectural_pdf", detected_discipline: "Architectural", is_active: true },
    { id: "r3", file_id: "f3", classification: "structural_pdf", detected_discipline: "Structural", is_active: false },
  ];

  it("returns the active row matching classification and discipline", () => {
    const result = findSupersedableRegistryRow(rows, "structural_pdf", "Structural");
    expect(result).toEqual({ id: "r1", file_id: "f1" });
  });

  it("ignores inactive rows", () => {
    // r3 is inactive with structural_pdf/Structural — only r1 should match
    const result = findSupersedableRegistryRow(rows, "structural_pdf", "Structural");
    expect(result?.id).toBe("r1");
  });

  it("returns null when classification does not match", () => {
    const result = findSupersedableRegistryRow(rows, "spec_pdf", "Structural");
    expect(result).toBeNull();
  });

  it("returns null when discipline does not match", () => {
    const result = findSupersedableRegistryRow(rows, "structural_pdf", "Mechanical");
    expect(result).toBeNull();
  });

  it("returns null for empty list", () => {
    expect(findSupersedableRegistryRow([], "structural_pdf", "Structural")).toBeNull();
  });

  it("matches when both disciplines are null", () => {
    const withNullDiscipline = [
      { id: "r4", file_id: "f4", classification: "unknown", detected_discipline: null, is_active: true },
    ];
    const result = findSupersedableRegistryRow(withNullDiscipline, "unknown", null);
    expect(result).toEqual({ id: "r4", file_id: "f4" });
  });

  it("does not match when only one discipline is null", () => {
    const withNullDiscipline = [
      { id: "r4", file_id: "f4", classification: "unknown", detected_discipline: null, is_active: true },
    ];
    const result = findSupersedableRegistryRow(withNullDiscipline, "unknown", "Structural");
    expect(result).toBeNull();
  });
});

describe("findCurrentEstimateVersionId", () => {
  it("returns the id of the is_current row", () => {
    const rows = [
      { id: "ev1", is_current: false, version_number: 1 },
      { id: "ev2", is_current: true, version_number: 2 },
    ];
    expect(findCurrentEstimateVersionId(rows)).toBe("ev2");
  });

  it("falls back to highest version_number when none is marked current", () => {
    const rows = [
      { id: "ev1", is_current: false, version_number: 1 },
      { id: "ev2", is_current: false, version_number: 3 },
      { id: "ev3", is_current: false, version_number: 2 },
    ];
    expect(findCurrentEstimateVersionId(rows)).toBe("ev2");
  });

  it("returns null for empty list", () => {
    expect(findCurrentEstimateVersionId([])).toBeNull();
  });

  it("returns the single row for a list of one", () => {
    const rows = [{ id: "ev1", is_current: false, version_number: 1 }];
    expect(findCurrentEstimateVersionId(rows)).toBe("ev1");
  });
});
