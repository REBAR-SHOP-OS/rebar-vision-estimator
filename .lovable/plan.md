

## Fix: MCP Server "Transport not bound to a server" Error

**Root cause**: Two issues in `supabase/functions/mcp-server/index.ts`:

1. **Wrong `mcpServer.tool()` signature** -- mcp-lite expects a single object `mcpServer.tool({ name, description, inputSchema, handler })`, but the current code uses a two-argument form `mcpServer.tool("name", { ... })`. This causes silent failures during tool registration, leaving the server uninitialized.

2. **Missing CORS headers for MCP protocol** -- ChatGPT's MCP client sends `Accept: application/json, text/event-stream` which needs to be allowed.

**Changes to `supabase/functions/mcp-server/index.ts`**:

1. Rewrite all 8 `mcpServer.tool()` calls from:
   ```typescript
   mcpServer.tool("list_projects", { description, inputSchema, handler })
   ```
   to:
   ```typescript
   mcpServer.tool({ name: "list_projects", description, inputSchema, handler })
   ```

2. Update CORS `Access-Control-Allow-Headers` to include `accept` header for MCP protocol compatibility.

All tool handlers and logic remain identical -- only the registration call signature changes.

