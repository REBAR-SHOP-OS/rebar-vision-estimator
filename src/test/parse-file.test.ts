import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PopulateSearchIndexResponse } from "@/lib/indexing-pipeline";

type MockConfig = {
  existingDv: { id: string; parse_status?: string; pdf_metadata?: Record<string, unknown> } | null;
  insertedDvId: string;
  rowCount: number;
  extractData: {
    pages: Array<{ page_number: number; raw_text: string; title_block?: Record<string, unknown> }>;
    total_pages: number;
    sha256: string;
    pdf_metadata?: Record<string, unknown>;
  };
  indexData: PopulateSearchIndexResponse;
};

const updates: Array<Record<string, unknown>> = [];
const inserts: Array<Record<string, unknown>> = [];
const invokes: Array<{ name: string; body: Record<string, unknown> }> = [];

let config: MockConfig;

const supabase = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
  },
  storage: {
    from: vi.fn(() => ({
      createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://example.test/file.pdf" } })),
    })),
  },
  functions: {
    invoke: vi.fn(async (name: string, options: { body: Record<string, unknown> }) => {
      invokes.push({ name, body: options.body });
      if (name === "extract-pdf-text") return { data: config.extractData, error: null };
      if (name === "populate-search-index") return { data: config.indexData, error: null };
      return { data: null, error: null };
    }),
  },
  from: vi.fn((table: string) => {
    if (table === "document_versions") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: config.existingDv, error: null })),
          })),
        })),
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserts.push(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: config.insertedDvId }, error: null })),
            })),
          };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          updates.push(payload);
          return {
            eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
          };
        }),
      };
    }

    if (table === "drawing_search_index") {
      return {
        select: vi.fn(() => {
          const builder = {
            eq: vi.fn(() => builder),
            then(resolve: (value: { count: number; error: null }) => unknown) {
              return Promise.resolve(resolve({ count: config.rowCount, error: null }));
            },
          };
          return builder;
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }),
};

vi.mock("@/integrations/supabase/client", () => ({ supabase }));
vi.mock("@/lib/pdf-to-images", () => ({
  renderPdfPagesToImages: vi.fn(async () => []),
}));
vi.mock("@/features/workflow-v2/accuracy-audit", () => ({
  auditIndexedPages: vi.fn(() => ({ audited: true })),
}));

describe("parseAndIndexFile", () => {
  beforeEach(() => {
    updates.length = 0;
    inserts.length = 0;
    invokes.length = 0;
    config = {
      existingDv: null,
      insertedDvId: "dv-1",
      rowCount: 2,
      extractData: {
        pages: [
          { page_number: 1, raw_text: "STRUCTURAL PLAN SHEET S1 REBAR BAR MARK B1 ".repeat(8) },
          { page_number: 2, raw_text: "STRUCTURAL SECTION SHEET S2 REBAR BAR MARK B2 ".repeat(8) },
        ],
        total_pages: 2,
        sha256: "sha-123",
      },
      indexData: {
        indexed: 2,
        skipped: 0,
        total: 2,
      },
    };
  });

  it("starts the parse job and passes the active project_id into indexing", async () => {
    const { parseAndIndexFile } = await import("@/lib/parse-file");

    const result = await parseAndIndexFile("project-123", {
      id: "file-1",
      legacy_file_id: "legacy-file-1",
      file_name: "S1.pdf",
      file_path: "user/project/S1.pdf",
    });

    expect(result.status).toBe("indexed");
    expect(invokes.find((call) => call.name === "populate-search-index")?.body).toMatchObject({
      project_id: "project-123",
      document_version_id: "dv-1",
      pipeline_file_id: "legacy-file-1",
    });
    expect(updates.some((payload) => payload.parse_status === "indexed")).toBe(true);
  });

  it("fails explicitly when indexing reports zero visible rows for the project", async () => {
    config.existingDv = { id: "dv-existing", parse_status: "pending", pdf_metadata: {} };
    config.rowCount = 0;
    config.indexData = {
      indexed: 0,
      skipped: 1,
      total: 1,
      duplicate_of: "row-in-other-project",
      message: "Exact duplicate detected (SHA-256 match). Existing entry: row-in-other-project",
    };
    config.extractData = {
      pages: [{ page_number: 1, raw_text: "STRUCTURAL PLAN SHEET S1 REBAR BAR MARK B1 ".repeat(8) }],
      total_pages: 1,
      sha256: "sha-duplicate",
    };

    const { parseAndIndexFile } = await import("@/lib/parse-file");

    const result = await parseAndIndexFile("project-456", {
      id: "file-2",
      legacy_file_id: "legacy-file-2",
      file_name: "S1-duplicate.pdf",
      file_path: "user/project/S1-duplicate.pdf",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("duplicate");
    expect(updates.some((payload) => payload.parse_status === "failed")).toBe(true);
  });
});
