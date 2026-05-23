# How to Access This Server

## Server Name Discovery

The server name used for resource and tool calls depends on your MCP client:

- **AntiGravity**: Prefixes tools with `mcp_` and uses underscores. If the server is named `memory-journal-mcp` in config, tools appear as `mcp_memory-journal-mcp_create_entry`. Use `memory-journal-mcp` as the server name for resource calls.
- **Cursor**: Prepends `user-` to the configured name. If the server is named `memory-journal-mcp` in config, use `user-memory-journal-mcp` for `ListMcpResources` and `FetchMcpResource` calls.
- **Other clients** (Claude Desktop, etc.): Likely use the configured name exactly. Only Cursor and AntiGravity have been verified — use the tool-prefix discovery method if unsure.

To identify your server name: look at the tool name prefix. Strip the tool name suffix to get the server name. Examples: `mcp_memory-journal-mcp_create_entry` → `memory-journal-mcp`; `user-memory-journal-mcp-create_entry` → `user-memory-journal-mcp`.

## Calling Tools

Use the tool functions directly — they are already available in your context by their full prefixed name.

## Reading Resources

Use the resource-reading mechanism provided by your MCP client with the discovered server name and `memory://` URIs.

Do NOT try to browse filesystem paths for MCP tool/resource definitions — use the MCP protocol directly.

## Quick Health Check

Fetch `memory://health` to verify server status, database stats, and tool availability.
