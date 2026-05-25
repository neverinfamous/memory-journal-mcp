---
name: mcp-builder
description: |
  Core rules for code quality and specifications of Model Context Protocol (MCP) servers. Use when reviewing MCP code quality, enforcing specification rules, or checking schemas/error responses. Must see the explicit keyword "MCP" or "Model Context Protocol". NOT for general REST APIs or Cloudflare Workers. If the user asks to "build a server" without specifying the type, you MUST ask for clarification.
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
- **Rate Limiting & Input Sanitization**: Aggressively sanitize path arguments to prevent directory traversal (`../../`), and apply basic rate-limiting to tools that trigger heavy compute or external API calls.

## 3. Deep References

For the complete MCP implementation guide, architecture diagrams, and detailed tooling patterns, consult the full reference:

- **[MCP Implementation Guide](references/implementation-guide.md)**: Contains transport selection (stdio vs. SSE), auth patterns, and multi-tool orchestration diagrams.

## 4. Scaffold Reference

When you need a minimal, fully compliant MCP server scaffold, use this structure:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Initialize the modern McpServer pattern
const server = new McpServer({ name: "my-mcp", version: "1.0.0" });

// Define tools using server.tool() which auto-registers schemas and handlers
server.tool(
  "my_tool",
  "Does something using an ID",
  { id: z.string().describe("The user ID to process") },
  async ({ id }) => {
    try {
      // Logic here (input is already validated by Zod)
      return { content: [{ type: "text", text: `Got ID: ${id}` }] };
    } catch (err) {
      // Graceful error return
      return { isError: true, content: [{ type: "text", text: `Error: ${err}` }] };
    }
  }
);

// Connect via standard I/O
const transport = new StdioServerTransport();
await server.connect(transport);
```
