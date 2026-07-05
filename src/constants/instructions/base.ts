export const CORE_INSTRUCTIONS = `# memory-journal-mcp

## Quick Access

| Purpose         | Action                      |
| --------------- | --------------------------- |
| Session context | \`memory://briefing\`         |
| Recent entries  | \`memory://recent\`           |
| Health/time     | \`memory://health\`           |
| Metrics/Summary | \`memory://metrics/summary\`  |
| Metrics/Latency | \`memory://metrics/latency\`  |
| Resource reads  | \`memory://metrics/resources\`|
| Project staleness| \`memory://staleness\`        |
| Report history  | \`memory://insights/reports\` |
| Agent context   | \`memory://agent-context/{repo}\` |
| Full context    | \`get-context-bundle\` prompt |

## Help Resources

- **Agent Skill:** If available in your environment, load the \`memory-journal-mcp\` skill for high-level workflow guidelines.
- **Dynamic Help:** Read \`memory://help\` for tool group index and available help resources.
- **Gotchas:** Read \`memory://help/gotchas\` for critical usage patterns, heuristics, and session summary rules.
- **Group Reference:** Read \`memory://help/{group}\` for per-group tool reference (parameters, annotations, examples).

Only help resources for your enabled tool groups are registered.

## Essential Behaviors

1. **Briefing:** You **MUST** read the \`memory://briefing/{+repo}\` at the start of each chat!
2. **Session Identity:** You MUST pass your AntiGravity Conversation ID as the \`--session-id\` argument for all CLI journal mutation commands.
3. **Workspace Isolation:** The \`--project\` argument is STRICTLY REQUIRED for mutations. Find it in the briefing's Config row. If you are mid-task and need this context, NEVER re-query the briefing; ALWAYS query \`memory://agent-context/{repo_name}\`.
4. **Anti-Hallucination:** If confused by an API, read \`memory://help/{group}\` or \`memory://help/gotchas\` BEFORE guessing. Use \`mcp-heal\` if a structural hallucination persists.
5. **Orphan Prevention:** ALWAYS link entries to previous context via \`--related-to\` (comma-separated entry IDs).

## Essential Operations

- **Creating Entries:** Use the \`memory-journal-mcp entry create\` CLI command via your terminal (\`run_command\`). CLI commands are ALWAYS available globally on the system; do NOT attempt to run them via Code Mode. ALL entries MUST define \`--impact-score\`, \`--trust-score\`, and \`--validation-status\`. See \`memory://help/core\` for criteria.
- **Session Summaries:** Use the \`memory-journal-mcp entry create\` CLI command with \`--type retrospective\` and \`--tags session-summary\`. You MUST provide the markdown content via \`--content "<string>"\` or \`--file <path>\` (or pipe to stdin). See \`memory://help/templates\` for the exact 4-section format required.
- **Updating/Deleting:** Use \`memory-journal-mcp entry update\` (pass \`--expected-version\` to prevent concurrent overwrites) and use the \`delete_entry\` MCP tool for soft-deletes.
- **Searching:** Use \`search_entries\` or \`search_by_date_range\`. Use \`sort_by: "importance"\` to surface structurally significant entries. Use phrase matching (e.g. \`"error handling"\`) for exact matches.
- **Team DB:** Append the \`--team\` flag to your CLI commands for shared state. Use \`team_*\` MCP tools ONLY for searches or deletes. See \`memory://help/team\` for RBAC rules. Do NOT create bulk relationships between unrelated entries that happen to share tags.`;

export const CODE_MODE_INSTRUCTIONS = `

## Code Mode

API: \`tool_name\` → \`mj.group.action()\` (e.g., \`search_entries\` → \`mj.search.searchEntries()\`)
Globals: \`createEntry()\`, \`find()\`, \`recent()\`, \`searchEntries()\`, \`deleteEntry()\`, \`help()\` work without the \`mj.\` prefix.
Positional: \`create("note")\`, \`searchEntries("performance")\`
Aliases: Common parameter names are auto-corrected (\`text\`/\`message\`/\`description\`→\`content\`, \`entry\`/\`id\`→\`entry_id\`, \`q\`/\`search\`→\`query\`, \`path\`/\`filepath\`→\`output_dir\`, \`keep\`→\`keep_count\`, \`user\`/\`assignee\`→\`target_user\`, \`severity\`→\`flag_type\`, \`team\`/\`project\`→\`workspace_id\`/\`project_number\`).
Discovery: \`mj.help()\` → \`{groups, totalMethods}\`. \`mj.core.help()\` for group-specific.
Anti-Hallucination: DO NOT invoke \`mj_execute_code\` with an empty \`code\` payload to "list tools". You must provide valid JavaScript in the \`code\` parameter.
Sandbox: No network access (\`fetch\` is undefined). \`setTimeout\` and \`sleep(ms)\` are available for minor delays.
Readonly: Pass \`readonly: true\` to \`mj_execute_code\` to restrict execution to read-only operations.
Read \`memory://help/codemode\` for full namespace table, examples, and patterns.
**Codemode-only**: When \`mj_execute_code\` is the only registered tool, all tool names referenced in these instructions (e.g., \`create_entry\`, \`search_entries\`) must be called via \`mj_execute_code\` using \`mj.*\` namespaces or bare globals. Do NOT call them as direct MCP tools. Note: This rule applies ONLY to MCP tools; CLI commands (like \`memory-journal-mcp entry create\`) should always be run natively in the terminal using \`run_command\`.`;
