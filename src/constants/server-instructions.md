<!-- SECTION:ESSENTIAL -->

# memory-journal-mcp

## Session Start

**REQUIRED**: Before processing any user request, read `memory://briefing` and **present the `userMessage` to the user as a formatted bullet list of key facts:**

- Entry counts (journal + team)
- GitHub: repo, branch, CI status, open issues/PRs
- Milestone progress (if any)
- Template resources count
- Optional metadata present (rulesFile, skillsDir, workflowSummary, copilotReviews, Team DB)

**Server name for resource calls**: Derive from tool prefixes — strip the tool name suffix to get the server name.

- **AntiGravity**: Tools are `mcp_{name}_{tool}` → server name = `memory-journal-mcp`
- **Cursor**: Tools are `user-{name}-{tool}` → server name = `user-memory-journal-mcp`
- **Other clients**: Use configured name exactly. Use tool-prefix discovery if unsure.

## Behaviors

- **Create entries for**: implementations, decisions, bug fixes, milestones, user requests to "remember"
- **Search before**: major decisions, referencing prior work, understanding project context
- **Link entries**: implementation→spec, bugfix→issue, followup→prior work

## Rule & Skill Suggestions

When you notice the user consistently applies patterns, preferences, or workflows that could be codified:

**Suggest adding a rule** when you observe:

- Naming conventions, formatting preferences, or coding standards
- Testing patterns or verification steps the user always follows
- Project-specific commands, workflows, or deployment steps
- Error handling patterns or logging conventions

**Suggest adding a skill** when you build:

- Reusable multi-step processes (e.g., deployment, release, audit workflows)
- Project-specific templates or scaffolds
- Complex integrations or tool chains the user may repeat

**Suggest refining existing rules/skills** when you notice:

- A rule conflict or ambiguity causing inconsistent behavior
- An outdated pattern that no longer matches the codebase
- Missing edge cases or exceptions to an existing rule
- A skill that could be extended with new steps

## Copilot Review Patterns

When the user has GitHub Copilot code review enabled:

**Learn from reviews** — After a PR is merged or reviewed, use `get_copilot_reviews(pr_number)` to read Copilot's findings. If patterns emerge (e.g., repeated null check warnings, missing error handling), suggest adding a rule or updating existing rules. Create journal entries tagged `copilot-finding` and link to the PR via `pr_number`.

**Pre-emptive checking** — Before creating or modifying code, search journal entries with tag `copilot-finding` for patterns relevant to the current work. Apply those patterns proactively to reduce review cycles.

**How to act:**

- The briefing shows **Rules** and **Skills** paths — use these to locate the files
- **Always ask the user first** — never create or modify rules/skills silently
- Frame suggestions as: "I noticed you always [pattern]. Would you like me to add/update a rule for this?"
- For skills, explain the workflow it would automate and what triggers it

## Quick Access

| Purpose         | Action                      |
| --------------- | --------------------------- |
| Session context | `memory://briefing`         |
| Recent entries  | `memory://recent`           |
| Health/time     | `memory://health`           |
| Semantic search | `semantic_search(query)`    |
| Full context    | `get-context-bundle` prompt |

## Code Mode (Token-Efficient Multi-Step Operations)

For multi-step workflows (3+ operations), prefer `mj_execute_code` over individual tool calls.
This executes JavaScript in a sandboxed environment with all tools available as `mj.*` API:

| Group         | Namespace            | Example                                            |
| ------------- | -------------------- | -------------------------------------------------- |
| Core          | `mj.core.*`          | `mj.core.createEntry("Implemented feature X")`     |
| Search        | `mj.search.*`        | `mj.search.searchEntries("performance")`           |
| Analytics     | `mj.analytics.*`     | `mj.analytics.getStatistics()`                     |
| Relationships | `mj.relationships.*` | `mj.relationships.linkEntries(1, 2, "implements")` |
| Export        | `mj.export.*`        | `mj.export.exportEntries("json")`                  |
| Admin         | `mj.admin.*`         | `mj.admin.rebuildVectorIndex()`                    |
| GitHub        | `mj.github.*`        | `mj.github.getGithubIssues({ state: "open" })`     |
| Backup        | `mj.backup.*`        | `mj.backup.backupJournal()`                        |
| Team          | `mj.team.*`          | `mj.team.teamCreateEntry("Team update")`           |

**Features**: Positional args (`createEntry("note")`), aliases (`mj.core.create`), `mj.help()` for discovery.
**Readonly mode**: `readonly: true` restricts to read-only tools only. Calling a mutation method (e.g., `mj.core.create(...)`) in readonly mode throws an error that halts execution — the sandbox returns `{ success: false, error: "Operation '...' is not found in group" }`. If a group has no methods at all (fully stripped), the error says `"no methods (read-only mode?)"`.
**Returns**: Last expression value. Errors return `{ success: false, error: "..." }`.

**Important — all `mj.*` methods return Promises. Always `await` them:**

```js
// ✅ Correct
const result = await mj.core.recent({ limit: 5 })
return result.entries.map(e => e.id)

// ❌ Wrong — returns a Promise object, not the entries
const result = mj.core.recent({ limit: 5 })

// ✅ Discovery
const help = await mj.help()           // { groups, totalMethods, usage }
const groupHelp = await mj.core.help() // { group, methods }
```

**`mj.core.recent()` return shape**: Returns `{ entries: JournalEntry[], count: number }` — not a plain array. Access `.entries` to iterate:

```js
const { entries, count } = await mj.core.recent({ limit: 10 })
return entries.map(e => ({ id: e.id, content: e.content.slice(0, 50) }))
```

<!-- SECTION:GITHUB -->

## GitHub Integration

- Include `issue_number`/`pr_number` in `create_entry` to auto-link
- After closing issue/merging PR → create summary entry with learnings
- CI failures → `actions-failure-digest` prompt or `memory://actions/recent`
- Kanban: `get_kanban_board(project_number)` → `move_kanban_item` → document completion
- Milestones: `get_github_milestones` → track project progress, `memory://github/milestones`
- GitHub tools auto-detect owner/repo from git context; specify explicitly if null

<!-- SECTION:HELP_POINTERS -->

## Help Resources

Read `memory://help` for tool group index and available help resources.
Read `memory://help/{group}` for per-group tool reference (parameters, annotations, examples).
Read `memory://help/gotchas` for critical field notes and usage patterns.
Only help resources for your enabled tool groups are registered.

<!-- SECTION:SERVER_ACCESS -->

## How to Access This Server

### Server Name Discovery

The server name used for resource and tool calls depends on your MCP client:

- **AntiGravity**: Prefixes tools with `mcp_` and uses underscores. If the server is named `memory-journal-mcp` in config, tools appear as `mcp_memory-journal-mcp_create_entry`. Use `memory-journal-mcp` as the server name for resource calls.
- **Cursor**: Prepends `user-` to the configured name. If the server is named `memory-journal-mcp` in config, use `user-memory-journal-mcp` for `ListMcpResources` and `FetchMcpResource` calls.
- **Other clients** (Claude Desktop, etc.): Likely use the configured name exactly. Only Cursor and AntiGravity have been verified — use the tool-prefix discovery method if unsure.

To identify your server name: look at the tool name prefix. Strip the tool name suffix to get the server name. Examples: `mcp_memory-journal-mcp_create_entry` → `memory-journal-mcp`; `user-memory-journal-mcp-create_entry` → `user-memory-journal-mcp`.

### Calling Tools

Use the tool functions directly — they are already available in your context by their full prefixed name.

### Reading Resources

Use the resource-reading mechanism provided by your MCP client with the discovered server name and `memory://` URIs.

Do NOT try to browse filesystem paths for MCP tool/resource definitions — use the MCP protocol directly.

## Quick Health Check

Fetch `memory://health` to verify server status, database stats, and tool availability.
