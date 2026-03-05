

## Plan: Expose App as MCP Server for ChatGPT

Based on the screenshot, you want to register your app as a Custom Tool (MCP server) in ChatGPT so GPT can read and write your shop drawing data. This requires creating an MCP-compatible edge function that ChatGPT can call.

### What gets built

**1. New edge function: `supabase/functions/mcp-server/index.ts`**

An MCP Streamable HTTP server using `mcp-lite` that exposes your existing capabilities as tools ChatGPT can call:

| Tool name | Description | Read/Write |
|---|---|---|
| `search_drawings` | Search shop drawings by query, bar mark, project, revision | Read |
| `list_projects` | List all projects for the authenticated user | Read |
| `get_drawing_details` | Get full details of a specific drawing version | Read |
| `get_pipeline_deals` | List CRM pipeline deals with files | Read |
| `create_project` | Create a new estimation project | Write |
| `upload_and_analyze` | Accept a file URL, download it, and trigger the estimation pipeline | Write |
| `update_drawing_status` | Update revision label or issue status on a drawing | Write |

**2. Authentication approach**

The MCP server will use a simple API key (Bearer token) auth. We will store a `MCP_API_KEY` secret that you generate and paste into ChatGPT's OAuth Client Secret field (or use API Key auth mode in ChatGPT). The edge function validates the Bearer token against this secret.

**3. Configuration**

- Add `[functions.mcp-server]` to `supabase/config.toml` with `verify_jwt = false` (auth handled internally via API key)
- Add `MCP_API_KEY` secret via the secrets tool

**4. ChatGPT setup**

Once deployed, you enter in ChatGPT's "New App" dialog:
- **MCP Server URL**: `https://ylfvyurpqplbijjfuuns.supabase.co/functions/v1/mcp-server`
- **Authentication**: API Key (or None if you prefer)
- **API Key**: the value you set for `MCP_API_KEY`

### Technical details

The edge function uses Hono + mcp-lite (`npm:mcp-lite@^0.10.0`) with `StreamableHttpTransport`. Each tool calls your existing database tables (`drawing_search_index`, `logical_drawings`, `projects`, etc.) via the service role Supabase client. The search tool reuses the existing `search_drawings` RPC function.

### Implementation order

1. Request `MCP_API_KEY` secret from you
2. Create `mcp-server/index.ts` with all tools
3. Update `config.toml`
4. Deploy and provide the URL for ChatGPT registration

