# memory-journal-mcp

## Quick Access

| Purpose         | Action                      |
| --------------- | --------------------------- |
| Session context | `memory://briefing`         |
| Recent entries  | `memory://recent`           |
| Health/time     | `memory://health`           |
| Metrics/Summary | `memory://metrics/summary`  |
| Metrics/Latency | `memory://metrics/latency`  |
| Resource reads  | `memory://metrics/resources`|
| Project staleness| `memory://staleness`        |
| Report history  | `memory://insights/reports` |
| Agent context   | `memory://agent-context/{repo}` |
| Full context    | `get-context-bundle` prompt |

## Help Resources

Read `memory://help` for tool group index and available help resources.
Read `memory://help/gotchas` for critical usage patterns, heuristics, and session summary rules.
Read `memory://help/{group}` for per-group tool reference (parameters, annotations, examples).
Only help resources for your enabled tool groups are registered.

## Essential Behaviors

1. **Briefing:** You **MUST** read the `memory://briefing/{+repo}` at the start of each chat!
2. **Session Identity:** You MUST pass your AntiGravity Conversation ID as the `--session-id` argument for all CLI journal mutation commands.
3. **Workspace Isolation:** The `--project` argument is STRICTLY REQUIRED for mutations. Find it in the briefing's Config row.
4. **Anti-Hallucination:** If confused by an API, read `memory://help/{group}` or `memory://help/gotchas` BEFORE guessing. Use `mcp-heal` if a structural hallucination persists.
5. **Orphan Prevention:** ALWAYS link entries to previous context via `--related-to` (comma-separated entry IDs).

## Essential Operations

- **Creating Entries:** Use the `memory-journal-mcp entry create` terminal command (or append `--team`). ALL entries MUST define `--impact-score`, `--trust-score`, and `--validation-status`. See `memory://help/core` for criteria.
- **Session Summaries:** Use `memory-journal-mcp entry create` with `--type retrospective` and `--tags session-summary`. You MUST provide the markdown content via `--content "<string>"` or `--file <path>` (or pipe to stdin). See `memory://help/templates` for the exact 4-section format required.
- **Updating/Deleting:** Use `memory-journal-mcp entry update` (pass `--expected-version` to prevent concurrent overwrites) and use the `delete_entry` MCP tool for soft-deletes.
- **Searching:** Use `search_entries` or `search_by_date_range`. Use `sort_by: "importance"` to surface structurally significant entries. Use phrase matching (e.g. `"error handling"`) for exact matches.
- **Team DB:** Append the `--team` flag to your CLI commands for shared state. Use `team_*` MCP tools ONLY for searches or deletes. See `memory://help/team` for RBAC rules. Do NOT create bulk relationships between unrelated entries that happen to share tags.