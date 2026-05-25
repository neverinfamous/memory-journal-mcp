---
name: mcp-builder
description: |
  Core rules for code quality and specifications of Model Context Protocol (MCP) servers. Use when reviewing MCP code quality, enforcing specification rules, or checking schemas/error responses. Must see the explicit keyword "MCP" or "Model Context Protocol". NOT for general REST APIs or Cloudflare Workers. NOT for generic "build a server" requests.
---

# MCP Server Builder Guidelines

This skill defines the high-integrity requirements for building MCP servers in this ecosystem.

## 1. Core Requirements

When building or modifying MCP servers, follow these prioritized rules:

- **Must**: Use Zod for all tool argument validation. Do not blindly trust MCP client inputs.
- **Must**: Return structured errors (`{ isError: true, content: [...] }`) from tools rather than throwing raw unhandled exceptions that crash the server.
- **Should**: Wrap handlers in try/catch blocks that gracefully surface errors to the LLM context.
- **Should**: Centralize error logging using standard prefixes (e.g., `[MCP Error]`).
- **Optional**: Depending on the repository, implement integration testing via Playwright for dual HTTP/SSE verification.

## 2. Security (Defense-in-Depth)

- **Blocklists are Defense-in-Depth**: A blocklist (e.g., forbidding `rm -rf` in a terminal tool) is not a primary security boundary. Your primary security is the sandbox, container, or strict schema validation.
- **No Secrets in Config**: MCP servers must rely on the environment variables for API keys and secrets, never hardcoded files inside the server repository.

## 3. Deep References

For the complete MCP implementation guide, architecture diagrams, and detailed tooling patterns, consult the full reference:

- **[MCP Implementation Guide](references/implementation-guide.md)**

## 4. Scaffold Reference

When you need a minimal, fully compliant MCP server scaffold, use this structure:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const server = new Server({ name: "my-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

const MyToolSchema = z.object({ id: z.string() });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "my_tool",
    description: "Does something",
    inputSchema: zodToJsonSchema(MyToolSchema) // Or pre-compiled JSON schema
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "my_tool") {
    try {
      const args = MyToolSchema.parse(request.params.arguments);
      return { content: [{ type: "text", text: `Got ID: ${args.id}` }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Validation Error: ${err}` }] };
    }
  }
  return { isError: true, content: [{ type: "text", text: "Unknown tool" }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```
