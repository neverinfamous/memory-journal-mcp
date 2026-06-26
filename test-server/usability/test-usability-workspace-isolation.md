# Re-Test memory-journal-mcp — Usability: Workspace Isolation

## Usability Scenario
Agent working across multiple workspaces should not see data leak between workspaces.

## Instructions
1. Configure your local test environment or server with multiple entries spanning different `workspace_id`s.
2. Invoke the tools directly (e.g. `search_entries`, `get_recent_entries`, `get_statistics`) and try to deliberately cause a data leak by omitting `workspace_id` or passing wildcard/invalid formats.
3. Confirm the server safely falls back to the default workspace or correctly filters, returning `{ success: false }` or an empty list if no data, rather than crashing or leaking data.
4. If the server leaks data or crashes, apply fixes to the server input schemas or implementation using the `mj-mcp-heal` skill.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
