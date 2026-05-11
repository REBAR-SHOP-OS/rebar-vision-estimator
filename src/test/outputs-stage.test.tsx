// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OutputsStage from "@/features/workflow-v2/stages/OutputsStage";

vi.mock("@/components/workspace/OutputsTab", () => ({
  default: ({ projectId }: { projectId: string }) => <div>Live outputs for {projectId}</div>,
}));

const baseState = {
  fileCount: 1,
  files: [],
  approvedScopeItems: [],
  scopeCandidates: 1,
  scopeAccepted: 1,
  takeoffRows: 1,
  qaOpen: 0,
  qaCriticalOpen: 0,
  estimatorConfirmed: true,
  refresh: vi.fn(),
  setLocal: vi.fn(),
  local: { calibrationConfirmed: true },
};

describe("OutputsStage", () => {
  it("renders the live outputs tab after estimator confirmation", () => {
    render(<OutputsStage projectId="project-1" state={baseState as any} />);
    expect(screen.getByText("Live outputs for project-1")).toBeInTheDocument();
  });

  it("shows a gate when estimator confirmation is missing", () => {
    render(<OutputsStage projectId="project-1" state={{ ...baseState, estimatorConfirmed: false } as any} />);
    expect(screen.getByText("Export Blocked: Estimator Confirmation Required")).toBeInTheDocument();
  });
});
