

## Fix: MCP Server -- Two Root Causes

The edge function logs show two distinct errors:

1. **`Cannot read properties of undefined (reading 'inputSchema')`** -- Wrong tool registration signature. mcp-lite expects **two arguments**: `mcpServer.tool("name", { description, inputSchema, handler })`. The current code passes a single object, so mcp-lite treats the object as the name string and `undefined` as the config, crashing on `.inputSchema`.

2. **`Transport not bound to a server`** -- The transport must be bound to the server before handling requests. The docs show `transport.bind(mcpServer)` returns an HTTP handler. Currently the code calls `transport.handleRequest(req, mcpServer)` without prior binding.

### Changes to `supabase/functions/mcp-server/index.ts`

**Fix 1 -- Tool registration (all 8 tools):**
```typescript
// FROM (broken):
mcpServer.tool({ name: "list_projects", description, inputSchema, handler })

// TO (correct per mcp-lite docs):
mcpServer.tool("list_projects", { description, inputSchema, handler })
```

**Fix 2 -- Transport binding:**
```typescript
// FROM (broken):
const transport = new StreamableHttpTransport();
app.all("/*", async (c) => {
  return await transport.handleRequest(c.req.raw, mcpServer);
});

// TO (correct per mcp-lite docs):
const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcpServer);
app.all("/*", async (c) => {
  if (c.req.method === "OPTIONS") { /* CORS response */ }
  return await httpHandler(c.req.raw);
});
```

All tool handler logic remains identical. Only the call signatures and transport setup change.

