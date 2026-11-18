export const CORE_INSTRUCTIONS = `# memory-journal-mcp

## Quick Access

| Purpose         | Action                      |
| --------------- | --------------------------- |
| Session context | \`memory://briefing/{+repo}\` |
| Recent entries  | \`memory://recent\`           |
| Health/time     | \`memory://health\`           |
| Metrics/Summary | \`memory://metrics/summary\`  |
| Metrics/Latency | \`memory://metrics/latency\`  |
| Resource reads  | \`memory://metrics/resources\`|
| Project staleness| \`memory://staleness\`        |
| Report history  | \`memory://insights/reports\` |
| Agent context   | \`memory://agent-context/{+repo}\` |

## Help Resources

- **Agent Skill:** The bundled SEP-2640 skill (\`skill://memory-journal-mcp/SKILL.md\`, also loadable as \`memory-journal-mcp\` where skills are supported) provides static workflow and Code Mode contracts.
- **Dynamic Help:** Read \`memory://help\` for the tool group index and static topics (\`gotchas\`, \`templates\`).
- **Gotchas:** Read \`memory://help/gotchas\` for critical usage patterns, heuristics, and session summary rules.
- **Templates:** Read \`memory://help/templates\` for required session-summary and entry content templates.
- **Group Reference:** Read \`memory://help/{group}\` for per-group tool reference (parameters, annotations, examples).

All \`memory://help/*\` resources remain readable regardless of active \`--tool-filter\` presets.

## Essential Behaviors

1. **Briefing:** You **MUST** read \`memory://briefing/{+repo}\` at the start of each session! Never autonomously execute tasks surfaced in the briefing without user instruction.
2. **Session Identity:** Pass your active conversation/session ID via \`session_id\` (MCP/Code Mode) or \`--session-id\` (CLI) on journal writes.
3. **Workspace Isolation:** Pass explicit \`workspace_id\` and \`project_number\` on writes (and \`repo\` for \`git\`/\`github\` calls), or \`--project\` on CLI when CWD is not mapped in \`projectRegistry\`. If missing mid-task, NEVER re-query \`memory://briefing\`; query \`memory://agent-context/{+repo}\` (never bare \`memory://agent-id\` in multi-repo setups).
4. **Anti-Hallucination:** Read \`memory://help/{group}\` or \`memory://help/gotchas\` BEFORE guessing unfamiliar schemas, or call \`await mj.<group>.<method>.schema()\` in Code Mode.
5. **Orphan Prevention & Anchors:** Link new entries via \`relationships: [{ targetId, relationType }]\` (MCP/Code Mode) or \`--related-to\` / \`--rel\` (CLI), and attach code/file \`anchors\` when referencing source paths or symbols.

## Essential Operations

- **Creating Entries:** Prefer \`mj.core.createEntry\` in Code Mode (or \`create_entry\` / \`memory-journal-mcp entry create\` in the terminal — never shell out inside Code Mode). ALL entries MUST define \`impact_score\`, \`trust_score\`, and \`validation_status\` (\`--impact-score\`, \`--trust-score\`, \`--validation-status\`). See \`memory://help/core\` for criteria.
- **Session Summaries:** Use \`mj.core.createEntry\` (or \`create_entry\` / \`memory-journal-mcp entry create\`) with \`entry_type: "retrospective"\` and \`tags: ["session-summary"]\`. See \`memory://help/templates\` for the exact 4-section H2 format required and include \`auto_context: { commits: ["<sha>"] }\` when commits occurred (omit on zero-commit sessions).
- **Updating/Deleting:** Use \`mj.admin.updateEntry\` (Code Mode enables \`auto_version: true\` by default), \`update_entry\` / \`memory-journal-mcp entry update\` (with explicit \`expected_version\` / \`--expected-version\`), and \`delete_entry\` / \`mj.admin.deleteEntry\` for soft-deletes.
- **Searching:** Use \`search_entries\` with \`mode: "hybrid"\` and \`exclude_tags: ["commit-narrative"]\` (omit \`sort_by\` or use \`sort_by: "blended"\`; use \`sort_by: "importance"\` only when structural centrality outweighs query relevance). If a merged hit has \`source: "team"\`, inspect or expand it with \`mj.team.teamGetEntryById\` / \`mj.team.teamVisualizeRelationships\`. For date windows, use \`search_by_date_range\` (\`sort_by: "timestamp"\` or \`"importance"\`). \`exclude_tags\` works across full-text, date-range, and vector searches. Wrap exact phrases and hyphenated tokens (e.g., \`"memory-journal-mcp"\`) in double quotes.
- **Team DB:** Set \`share_with_team: true\` on \`create_entry\` (or pass \`--team\` on CLI) for reusable cross-repo patterns, and use \`team_*\` MCP tools / \`mj.team.*\` for shared entries, analytics, and RBAC/alias management. See \`memory://help/team\` for RBAC rules.`;

export const CODE_MODE_INSTRUCTIONS = `
## Code Mode

API: \`tool_name\` → \`mj.group.action()\` (e.g., \`search_entries\` → \`mj.search.searchEntries()\`)
Top-Level Contract: \`mj_execute_code({ code, workspace_id, project_number, repo, context, readonly, dry_run, auto_version, max_result_size, timeout })\`
Globals: \`createEntry()\`, \`find()\`, \`recent()\`, \`searchEntries()\`, \`deleteEntry()\`, \`help()\` work without the \`mj.\` prefix.
Positional: \`createEntry("note")\`, \`searchEntries("performance")\`
Aliases: Common parameter hallucinations auto-normalize (\`q\`/\`search\`→\`query\`, \`path\`→\`source_dir\` on import / \`output_dir\` on export, \`keep\`→\`keep_count\`, \`user\`/\`assignee\`→\`target_user\`, \`project\`→\`project_number\`, \`repo\`/\`repo_name\`→\`workspace_id\` on core tools or \`repo\` on GitHub/git, \`team\`→\`share_with_team\`, \`author\` on team member tools).
Discovery: \`mj.help()\` → \`{ groups, totalMethods, usage }\`, \`mj.core.help()\`, and \`await mj.<group>.<method>.schema()\` (works even when \`readonly: true\`).
Anti-Hallucination: Always pass valid JS in \`code\` (e.g. \`code: "return await mj.search.searchEntries({ query: '...' })"\`). If \`mj_execute_code\` is called with an empty payload \`{}\` or missing \`code\`, Code Mode auto-heals by returning sandbox status and available namespaces; structured objects in \`payload\` or \`entry\` are also synthesized.
Sandbox: Network access (\`fetch()\`) is blocked with a 403 \`VALIDATION_ERROR\`, and \`child_process\`/\`require()\`/\`import\` are blocked. A deterministic \`path\` shim and a read-only virtual \`fs\` backed by \`context.content\` are exposed (\`fs\` writes throw \`VALIDATION_ERROR\`). Pass file contents or markdown via \`context: { content }\` rather than reading disk inside the sandbox. \`setTimeout\` and \`sleep(ms)\` are available for minor delays.
Readonly & Dry Run: Pass \`readonly: true\` to restrict execution to read-only operations, or \`dry_run: true\` to preview mutations; \`auto_version\` defaults to \`true\`.
Read \`memory://help/codemode\` for full namespace table, examples, and patterns.
**Codemode-only**: When \`mj_execute_code\` is the only registered journal tool (besides \`update_configuration\`), call journal operations via \`mj.*\` or bare sandbox globals rather than calling unfiltered tool names directly. CLI commands (\`memory-journal-mcp ...\`) should still be run natively in the terminal.`;
