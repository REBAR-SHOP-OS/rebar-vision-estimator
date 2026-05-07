// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AssistantStage from "@/features/workflow-v2/stages/AssistantStage";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const messageRows: any[] = [];
const query: any = {
  select: vi.fn(() => query),
  eq: vi.fn(() => query),
  order: vi.fn(() => query),
  limit: vi.fn(() => Promise.resolve({ data: messageRows, error: null })),
  insert: vi.fn(() => Promise.resolve({ error: null })),
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => query),
    storage: { from: vi.fn(() => ({ upload: vi.fn() })) },
  },
}));

vi.mock("@/lib/rebar-intake", () => ({
  createProjectFileWithCanonicalBridge: vi.fn(),
  ensureCurrentProjectRebarBridge: vi.fn(),
  inferRebarFileKind: vi.fn(() => "other"),
}));

vi.mock("@/features/workflow-v2/takeoff-data", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    loadWorkflowQaIssues: vi.fn(() => Promise.resolve([])),
    loadWorkflowTakeoffRows: vi.fn(() => Promise.resolve([])),
  };
});

const state: any = {
  fileCount: 1,
  files: [{ id: "file-1", file_name: "S.pdf", file_path: "x", created_at: "2026-01-01" }],
  approvedScopeItems: [],
  scopeCandidates: 1,
  scopeAccepted: 1,
  takeoffRows: 1,
  qaOpen: 0,
  qaCriticalOpen: 0,
  estimatorConfirmed: false,
  refresh: vi.fn(),
  setLocal: vi.fn(),
  local: {},
};

describe("AssistantStage", () => {
  it("renders as a workflow stage", async () => {
    messageRows.length = 0;
    render(<AssistantStage projectId="project-1" state={state} />);

    expect(await screen.findByText("Parallel Assistant")).toBeInTheDocument();
    expect(await screen.findByText("Ask the assistant to inspect blockers.")).toBeInTheDocument();
  });

  it("renders persisted working steps", async () => {
    messageRows.length = 0;
    messageRows.push({
      id: "msg-1",
      role: "assistant",
      content: "Found answer",
      created_at: "2026-01-01T00:00:00Z",
      metadata: {
        channel: "workflow_v2_assistant",
        kind: "suggestion",
        working_steps: ["Checking QA issues"],
      },
    });
    render(<AssistantStage projectId="project-1" state={state} />);

    expect(await screen.findByText("Found answer")).toBeInTheDocument();
    expect(await screen.findByText("Checking QA issues")).toBeInTheDocument();
  });
});
