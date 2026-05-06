export type StageKey =
  | "files"
  | "scope"
  | "takeoff"
  | "qa"
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
  { key: "takeoff", label: "Takeoff Workspace", short: "Takeoff", index: 3 },
  { key: "qa", label: "QA Gate", short: "QA", index: 4 },
  { key: "confirm", label: "Estimator Confirmation", short: "Confirm", index: 5 },
  { key: "outputs", label: "Outputs", short: "Outputs", index: 6 },
];

export type RowStatus = "ready" | "review" | "blocked";
export type IssueSeverity = "critical" | "error" | "warning" | "info";