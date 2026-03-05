import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { McpServer, StreamableHttpTransport } from "npm:mcp-lite@^0.10.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const app = new Hono();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ── MCP Server ──────────────────────────────────────────────

const mcpServer = new McpServer({
  name: "rebar-vision-mcp",
  version: "1.0.0",
});

// ── Read Tools ──────────────────────────────────────────────

mcpServer.tool("list_projects", {
  description: "List all estimation projects. Returns id, name, status, client_name, project_type, created_at.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter by status (e.g. active, completed)" },
      limit: { type: "number", description: "Max results (default 50)" },
    },
  },
  handler: async ({ status, limit }: { status?: string; limit?: number }) => {
    const sb = adminClient();
    let q = sb.from("projects").select("id, name, status, client_name, project_type, created_at, updated_at").order("created_at", { ascending: false }).limit(limit || 50);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("search_drawings", {
  description: "Search shop drawings by text query, bar mark, project, discipline, revision, CRM deal. Returns ranked results with highlighted snippets.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text search query" },
      project_id: { type: "string", description: "Filter by project UUID" },
      bar_mark: { type: "string", description: "Exact bar mark to find" },
      discipline: { type: "string", description: "Filter by discipline (e.g. structural)" },
      drawing_type: { type: "string", description: "Filter by drawing type" },
      revision: { type: "string", description: "Filter by revision label" },
      crm_deal_id: { type: "string", description: "Filter by CRM deal ID" },
      sheet_id: { type: "string", description: "Filter by sheet ID (e.g. S-201)" },
      limit: { type: "number", description: "Max results (default 50)" },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const sb = adminClient();
    let q = sb.from("drawing_search_index")
      .select(`
        id, project_id, logical_drawing_id, page_number, revision_label,
        issue_status, crm_deal_id, bar_marks, extracted_entities, raw_text, created_at,
        logical_drawings!inner(sheet_id, discipline, drawing_type),
        projects!inner(name)
      `)
      .order("created_at", { ascending: false })
      .limit((params.limit as number) || 50);

    if (params.project_id) q = q.eq("project_id", params.project_id as string);
    if (params.discipline) q = q.eq("logical_drawings.discipline", params.discipline as string);
    if (params.drawing_type) q = q.eq("logical_drawings.drawing_type", params.drawing_type as string);
    if (params.revision) q = q.eq("revision_label", params.revision as string);
    if (params.crm_deal_id) q = q.eq("crm_deal_id", params.crm_deal_id as string);
    if (params.sheet_id) q = q.eq("logical_drawings.sheet_id", params.sheet_id as string);
    if (params.bar_mark) q = q.contains("bar_marks", [params.bar_mark as string]);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_drawing_details", {
  description: "Get full details of a specific drawing search index entry by ID, including linked logical drawing and document version info.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The drawing_search_index UUID" },
    },
    required: ["id"],
  },
  handler: async ({ id }: { id: string }) => {
    const sb = adminClient();
    const { data, error } = await sb
      .from("drawing_search_index")
      .select(`
        *, 
        logical_drawings(*),
        document_versions(*),
        sheet_revisions(*),
        projects(name, client_name, project_type, status)
      `)
      .eq("id", id)
      .single();
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_pipeline_deals", {
  description: "List CRM pipeline deals with metadata.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter by deal status" },
      limit: { type: "number", description: "Max results (default 50)" },
    },
  },
  handler: async ({ status, limit }: { status?: string; limit?: number }) => {
    const sb = adminClient();
    let q = sb.from("crm_deals").select("*").order("synced_at", { ascending: false }).limit(limit || 50);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_project_details", {
  description: "Get full details of a project including files, messages, estimates, and drawings.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "Project UUID" },
    },
    required: ["project_id"],
  },
  handler: async ({ project_id }: { project_id: string }) => {
    const sb = adminClient();
    const [project, files, estimates, drawings] = await Promise.all([
      sb.from("projects").select("*").eq("id", project_id).single(),
      sb.from("project_files").select("id, file_name, file_type, file_size, created_at").eq("project_id", project_id),
      sb.from("estimate_versions").select("*").eq("project_id", project_id).order("version_number", { ascending: false }),
      sb.from("drawing_search_index").select("id, page_number, revision_label, bar_marks, issue_status, created_at").eq("project_id", project_id),
    ]);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          project: project.data,
          files: files.data,
          estimates: estimates.data,
          drawings: drawings.data,
        }, null, 2),
      }],
    };
  },
});

// ── Write Tools ─────────────────────────────────────────────

mcpServer.tool("create_project", {
  description: "Create a new estimation project.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Project name" },
      client_name: { type: "string", description: "Client name" },
      description: { type: "string", description: "Project description" },
      project_type: { type: "string", description: "Project type (e.g. residential, commercial)" },
    },
    required: ["name"],
  },
  handler: async (params: { name: string; client_name?: string; description?: string; project_type?: string }) => {
    const sb = adminClient();
    const { data: users } = await sb.from("profiles").select("user_id").limit(1);
    const userId = users?.[0]?.user_id;
    if (!userId) return { content: [{ type: "text", text: "Error: No users found" }] };

    const { data, error } = await sb.from("projects").insert({
      name: params.name,
      client_name: params.client_name || null,
      description: params.description || null,
      project_type: params.project_type || null,
      user_id: userId,
      status: "active",
    }).select().single();
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("update_drawing_status", {
  description: "Update revision label or issue status on a drawing search index entry.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "drawing_search_index UUID" },
      revision_label: { type: "string", description: "New revision label" },
      issue_status: { type: "string", description: "New issue status" },
    },
    required: ["id"],
  },
  handler: async ({ id, revision_label, issue_status }: { id: string; revision_label?: string; issue_status?: string }) => {
    const sb = adminClient();
    const updates: Record<string, string> = {};
    if (revision_label !== undefined) updates.revision_label = revision_label;
    if (issue_status !== undefined) updates.issue_status = issue_status;
    if (Object.keys(updates).length === 0) return { content: [{ type: "text", text: "No updates provided" }] };

    const { data, error } = await sb.from("drawing_search_index").update(updates).eq("id", id).select().single();
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("update_project", {
  description: "Update project fields like name, status, client_name, description.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "Project UUID" },
      name: { type: "string" },
      status: { type: "string" },
      client_name: { type: "string" },
      description: { type: "string" },
    },
    required: ["project_id"],
  },
  handler: async (params: { project_id: string; name?: string; status?: string; client_name?: string; description?: string }) => {
    const sb = adminClient();
    const { project_id, ...updates } = params;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    if (Object.keys(filtered).length === 0) return { content: [{ type: "text", text: "No updates provided" }] };

    const { data, error } = await sb.from("projects").update(filtered).eq("id", project_id).select().single();
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

// ── Transport ───────────────────────────────────────────────

const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcpServer);

app.all("/*", async (c) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-api-key, content-type, accept, x-client-info, apikey",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      },
    });
  }

  return await httpHandler(c.req.raw);
});

Deno.serve(app.fetch);
