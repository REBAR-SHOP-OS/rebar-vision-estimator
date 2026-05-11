export type StageKey =
  | "files"
  | "scope"
  | "calibration"
  | "takeoff"
  | "qa"
  | "assistant"
  | "confirm"
  | "outputs";

export interface StageDef {
  key: StageKey;
  label: string;
  index: number;
  short: string;
}

export const STAGES: StageDef[] = [
  { key: "files", label: "Files + Revisions", short: "Files", index: 1 },
  { key: "scope", label: "Scope Review", short: "Scope", index: 2 },
  { key: "calibration", label: "Scale Calibration", short: "Calibrate", index: 3 },
  { key: "takeoff", label: "Takeoff Workspace", short: "Takeoff", index: 4 },
  { key: "qa", label: "QA Gate", short: "QA", index: 5 },
  { key: "confirm", label: "Estimator Confirmation", short: "Confirm", index: 6 },
  { key: "outputs", label: "Outputs", short: "Outputs", index: 7 },
];

export type RowStatus = "ready" | "review" | "blocked";
export type IssueSeverity = "critical" | "error" | "warning" | "info";
