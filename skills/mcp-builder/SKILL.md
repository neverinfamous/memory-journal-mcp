---
name: mcp-builder
description: |
  Core rules for scaffolding, implementing, and securing Model Context Protocol (MCP) servers. Use when building a new MCP server, adding tools to an existing one, or fixing tool schemas and error responses.
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
