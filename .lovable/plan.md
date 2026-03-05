

## Fix: MCP Server Crash

**Root cause**: Wrong `mcpServer.tool()` call signature. mcp-lite expects:
```
mcpServer.tool("tool_name", { description, inputSchema, handler })
```
Current code incorrectly passes a single object:
```
mcpServer.tool({ name: "tool_name", description, inputSchema, handler })
```

**Changes to `supabase/functions/mcp-server/index.ts`**:

1. Fix all `mcpServer.tool()` calls to use `(name, config)` two-argument pattern
2. Remove the `authorize()` function and auth check middleware (Option B: No Auth)
3. Remove the `MCP_API_KEY` env reference

All 8 tool registrations (`list_projects`, `search_drawings`, `get_drawing_details`, `get_pipeline_deals`, `get_project_details`, `create_project`, `update_drawing_status`, `update_project`) will be updated to the correct signature.

