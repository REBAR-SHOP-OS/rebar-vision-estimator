// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowShell from "@/features/workflow-v2/WorkflowShell";

const mockWorkflowState = vi.hoisted(() => ({
  value: {
    fileCount: 2,
    files: [],
    approvedScopeItems: ["scope-1"],
    scopeCandidates: 2,
    scopeAccepted: 1,
    takeoffRows: 57,
    qaOpen: 0,
    qaCriticalOpen: 0,
    estimatorConfirmed: true,
    canonicalExportStatus: "verified" as const,
    exportBlockedReasons: [] as string[],
    refresh: vi.fn(),
    setLocal: vi.fn(),
    local: { calibrationConfirmed: true },
  },
}));

const setStageStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/workflow-v2/useWorkflowState", () => ({
  useWorkflowState: () => mockWorkflowState.value,
}));

vi.mock("@/features/workflow-v2/active-stage", () => ({
  useActiveStage: () => ["outputs", vi.fn()],
  setStageStatus: setStageStatusMock,
}));

vi.mock("@/features/workflow-v2/stages/FilesStage", () => ({ default: () => <div>Files</div> }));
vi.mock("@/features/workflow-v2/stages/ScopeStage", () => ({ default: () => <div>Scope</div> }));
vi.mock("@/features/workflow-v2/stages/CalibrationStage", () => ({ default: () => <div>Calibration</div> }));
vi.mock("@/features/workflow-v2/stages/TakeoffStage", () => ({ default: () => <div>Takeoff</div> }));
vi.mock("@/features/workflow-v2/stages/QAStage", () => ({ default: () => <div>QA</div> }));
vi.mock("@/features/workflow-v2/stages/AssistantStage", () => ({ default: () => <div>Assistant</div> }));
vi.mock("@/features/workflow-v2/stages/ConfirmStage", () => ({ default: () => <div>Confirm</div> }));
vi.mock("@/features/workflow-v2/stages/OutputsStage", () => ({ default: () => <div>Outputs</div> }));

describe("WorkflowShell", () => {
  beforeEach(() => {
    mockWorkflowState.value = {
      fileCount: 2,
      files: [],
      approvedScopeItems: ["scope-1"],
      scopeCandidates: 2,
      scopeAccepted: 1,
      takeoffRows: 57,
      qaOpen: 0,
      qaCriticalOpen: 0,
      estimatorConfirmed: true,
      canonicalExportStatus: "verified",
      exportBlockedReasons: [],
      refresh: vi.fn(),
      setLocal: vi.fn(),
      local: { calibrationConfirmed: true },
    };
    setStageStatusMock.mockReset();
  });

  it("shows outputs blocked when canonical verification is blocked", () => {
    mockWorkflowState.value = {
      ...mockWorkflowState.value,
      canonicalExportStatus: "blocked",
      exportBlockedReasons: ["Blocked: 25 line(s) below confidence threshold (0.5)."],
    };

    render(
      <WorkflowShell
        projectId="8a182703-d47a-40f9-9d4e-111111111111"
        project={{ name: "CRU-1 Architectural" }}
      />,
    );

    expect(screen.getByText("BLOCKED")).toBeInTheDocument();
    expect(screen.getByText(/Canonical Verification Blocked/)).toBeInTheDocument();
    expect(screen.getByText(/Exports Still Locked/)).toBeInTheDocument();
  });

  it("shows outputs ready only after canonical verification passes", () => {
    render(
      <WorkflowShell
        projectId="8a182703-d47a-40f9-9d4e-111111111111"
        project={{ name: "CRU-1 Architectural" }}
      />,
    );

    expect(screen.getByText("READY")).toBeInTheDocument();
    expect(screen.getByText(/Estimator Confirmed/)).toBeInTheDocument();
    expect(screen.getByText(/Outputs Unlocked/)).toBeInTheDocument();
  });

  it("uses one horizontal scroll shell and keeps the body on vertical-only scrolling", () => {
    const { container } = render(
      <WorkflowShell
        projectId="8a182703-d47a-40f9-9d4e-111111111111"
        project={{ name: "CRU-1 Architectural" }}
      />,
    );

    expect(container.querySelector(".overflow-x-auto.overflow-y-hidden")).not.toBeNull();
    expect(container.querySelector(".overflow-y-auto.overflow-x-visible")).not.toBeNull();
  });
});
