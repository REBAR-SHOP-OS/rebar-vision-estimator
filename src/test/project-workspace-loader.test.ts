import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadWorkspaceProject } from "@/pages/project-workspace-loader";

const getCanonicalProjectByLegacyId = vi.fn();

vi.mock("@/lib/rebar-read-model", () => ({
  getCanonicalProjectByLegacyId: (...args: unknown[]) => getCanonicalProjectByLegacyId(...args),
}));

function createQuery<T>(result: T) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

describe("loadWorkspaceProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a legacy project directly", async () => {
    const legacyProject = {
      id: "legacy-1",
      name: "Legacy Project",
      client_name: "Client",
      address: "Address",
      status: "estimated",
    };
    const projectsQuery = createQuery({ data: legacyProject, error: null });
    const linksQuery = createQuery({ data: null, error: null });
    const supabase = {
      from: vi.fn((table: string) => (table === "projects" ? projectsQuery : linksQuery)),
    } as any;

    getCanonicalProjectByLegacyId.mockResolvedValue({
      projectName: "Canonical Project",
      customerName: "Canonical Client",
      location: "Canonical Location",
      rebarProjectId: "rebar-1",
      status: "active",
    });

    const result = await loadWorkspaceProject(supabase, "legacy-1");

    expect(result?.id).toBe("legacy-1");
    expect(result?.project_name).toBe("Canonical Project");
    expect(result?.customer_name).toBe("Canonical Client");
    expect(getCanonicalProjectByLegacyId).toHaveBeenCalledWith(supabase, "legacy-1");
  });

  it("resolves a route rebar project id back to its linked legacy project", async () => {
    const missingProjectQuery = createQuery({ data: null, error: null });
    const linkedProjectQuery = createQuery({
      data: {
        id: "legacy-2",
        name: "Linked Legacy Project",
        client_name: "Linked Client",
        address: null,
        status: "scope_detected",
      },
      error: null,
    });
    const linksQuery = createQuery({
      data: { legacy_project_id: "legacy-2" },
      error: null,
    });

    const from = vi.fn((table: string) => {
      if (table === "projects") {
        return from.mock.calls.filter(([name]) => name === "projects").length === 1
          ? missingProjectQuery
          : linkedProjectQuery;
      }
      if (table === "rebar_project_links") return linksQuery;
      throw new Error(`Unexpected table ${table}`);
    });
    const supabase = { from } as any;

    getCanonicalProjectByLegacyId.mockResolvedValue({
      projectName: "Linked Canonical",
      customerName: "Linked Canonical Client",
      location: "Plant 4",
      rebarProjectId: "rebar-2",
      status: "active",
    });

    const result = await loadWorkspaceProject(supabase, "rebar-2");

    expect(result?.id).toBe("legacy-2");
    expect(result?.rebar_project_id).toBe("rebar-2");
    expect(result?.project_name).toBe("Linked Canonical");
    expect(getCanonicalProjectByLegacyId).toHaveBeenCalledWith(supabase, "legacy-2");
  });
});
