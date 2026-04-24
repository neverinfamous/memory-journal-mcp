<!-- SECTION:CORE -->

# memory-journal-mcp

## **ESSENTIAL SESSION START!**

1. You **MUST** read the `memory://briefing/{repo_name}` at the start of each chat!
2. Use the standard MCP `read_resource` tool for this (do NOT use Code Mode/execute_code).
3. Infer the `repo_name` from the user's prompt or your active workspace context.
4. **ACKNOWLEDGE FLAGS**: If the briefing JSON contains `activeFlags` (count > 0), you MUST print an alert ABOVE the table: `⚠️ **{count} active flag(s)** — review before proceeding.` followed by each flag (`🚩 {flag_type} → @{target_user}: {preview}`).
5. **RENDER TABLE**: Parse the remaining JSON into a dense 2-column Markdown Table (Field, Value).
   - **RESTRICTION**: NO bulleted lists inside the table. Do NOT truncate summaries or issues.
   - **FORMATTING**: Group related properties (use `<br>` for line breaks).
   - **REQUIRED GROUPS**: GitHub, Issues, Entry Counts, Latest Entries/Summaries, Analytics, Milestones, Workspaces.
6. **STOP & WAIT**: Do NOT autonomously resume past tasks or start work on new issues. The briefing is strictly for context.

- **AntiGravity**: Tools are `mcp_{name}_{tool}` → server name = `memory-journal-mcp`
- **Cursor**: Tools are `user-{name}-{tool}` → server name = `user-memory-journal-mcp`
- **Other clients**: Use configured name exactly. Use tool-prefix discovery if unsure.

## Behaviors

### memory-journal-mcp Behaviors

- **Personal vs Team**: **ALWAYS use the personal journal** (e.g., `create_entry`) by default. ONLY save to the team journal (e.g., `team_create_entry`) if the user explicitly requests it.
- **Create entries for**: implementations, decisions, bug fixes, milestones, user requests to "remember"
- **Search before**: major decisions, referencing prior work, understanding project context. Use `sort_by: "importance"` on `search_entries`, `get_recent_entries`, or `search_by_date_range` to surface structurally significant entries (decisions, milestones, highly-connected nodes) over simply recent ones.
- **Analyze insights**: Use cross-project insights (`get_cross_project_insights`) before defining architectures. Use `team_get_collaboration_matrix` to evaluate team health, cross-author activity patterns, and collaboration impact. Use repo insights (`memory://github/insights`) to gauge traction. View `memory://insights/digest` and `memory://insights/team-collaboration` for automated analytics snapshots.
- **Link entries**: implementation→spec, bugfix→issue, followup→prior work

### Rule & Skill Suggestions

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

**How to act:**

- The briefing shows **Rules** and **Skills** paths — use these to locate the files
- **Always ask the user first** — never create or modify rules/skills silently
- Frame suggestions as: "I noticed you always [pattern]. Would you like me to add/update a rule for this?"
- For skills, explain the workflow it would automate and what triggers it

### Native Agent Skills (NPM Distribution)

This server leverages the `neverinfamous-agent-skills` package. If the user's `SKILLS_DIR_PATH` environment variable targets these, you have native access to foundational frameworks (`typescript`, `react-best-practices`, `playwright-standard`, `golang`, `rust`, `python`, `docker`, `tailwind-css`, `shadcn-ui`) and the `github-commander` DevOps workflows (`issue-triage`, `pr-review`, `github-actions`, `copilot-audit`, etc.). The `adversarial-planner` skill provides multi-pass plan review with structured critique stages.

- The user can distribute or update these skills across their repositories by running `npx neverinfamous-agent-skills@latest`.
- If you need to create a new skill, reference the bundled `skill-builder` instructions!

### Hush Protocol (Team Flags)

Flags are machine-actionable signals stored in the team database. They replace Slack/Teams noise with structured, searchable entries that surface automatically in the briefing.

**When to create a flag** (`pass_team_flag`):

- `blocker` — work is blocked and requires another person's action
- `needs_review` — code, document, or decision needs peer review
- `help_requested` — stuck and need guidance or pairing
- `fyi` — non-blocking awareness signal (completed migration, config change, etc.)

**When to resolve** (`resolve_team_flag`): After the blocking condition is cleared. Include a brief resolution comment describing what was done. Resolving is idempotent — safe to call on already-resolved flags.

**Briefing integration**: The `memory://briefing` payload includes `activeFlags` when unresolved flags exist. The user's agent rules may instruct you to render these prominently. Always check for and acknowledge active flags at session start.

**Dashboard**: Read `memory://flags` to see all active (unresolved) flags. Read `memory://flags/vocabulary` to see the configured flag types.

**Code Mode**: `mj.team.passTeamFlag({ flag_type, message })` and `mj.team.resolveTeamFlag({ flag_id })`.

<!-- SECTION:COPILOT -->

## Copilot Review Patterns

When the user has GitHub Copilot code review enabled:

**Learn from reviews** — After a PR is merged or reviewed, use `get_copilot_reviews(pr_number)` to read Copilot's findings. If patterns emerge (e.g., repeated null check warnings, missing error handling), suggest adding a rule or updating existing rules. Create journal entries tagged `copilot-finding` and link to the PR via `pr_number`.

**Pre-emptive checking** — Before creating or modifying code, search journal entries with tag `copilot-finding` for patterns relevant to the current work. Apply those patterns proactively to reduce review cycles.

**How to act:**

- The briefing shows **Rules** and **Skills** paths — use these to locate the files
- **Always ask the user first** — never create or modify rules/skills silently
- Frame suggestions as: "I noticed you always [pattern]. Would you like me to add/update a rule for this?"
- For skills, explain the workflow it would automate and what triggers it

<!-- SECTION:CODE_MODE -->

## Code Mode (Token-Efficient Multi-Step Operations)

For multi-step workflows (3+ operations), prefer `mj_execute_code` over individual tool calls.
This executes JavaScript in a sandboxed environment with all tools available as `mj.*` API:

| Group         | Namespace            | Example                                            |
| ------------- | -------------------- | -------------------------------------------------- |
| Core          | `mj.core.*`          | `mj.core.createEntry("Implemented feature X")`     |
| Search        | `mj.search.*`        | `mj.search.searchEntries("performance")`           |
| Analytics     | `mj.analytics.*`     | `mj.analytics.getStatistics()`                     |
| Relationships | `mj.relationships.*` | `mj.relationships.linkEntries(1, 2, "implements")` |
| IO            | `mj.io.*`            | `mj.io.importMarkdown("content")`                  |
| Export        | `mj.export.*`        | `mj.export.exportEntries("json")`                  |
| Admin         | `mj.admin.*`         | `mj.admin.rebuildVectorIndex()`                    |
| GitHub        | `mj.github.*`        | `mj.github.getGithubIssues({ state: "open" })`     |
| Backup        | `mj.backup.*`        | `mj.backup.backupJournal()`                        |
| Team          | `mj.team.*`          | `mj.team.teamCreateEntry("Team update")`           |

**Features**: Positional args (`createEntry("note")`), aliases (`mj.core.create`), `mj.help()` for discovery.
**Readonly mode**: `readonly: true` restricts to read-only tools only. Calling a mutation method (e.g., `mj.core.create(...)`) in readonly mode throws an error that halts execution — the sandbox returns `{ success: false, error: "Operation '...' is not found in group" }`. If a group has no methods at all (fully stripped), the error says `"no methods (read-only mode?)"`.
**Returns**: Last expression value. Errors return `{ success: false, error: "..." }`.

**GitHub Context Injection**: You can pass `repo: 'my-repo'` directly to `mj_execute_code` (e.g., `mj_execute_code({ code, repo: 'memory-journal-mcp' })`) to instantly bind that repository and its default Kanban board to all GitHub and Kanban tools running inside the sandbox, avoiding the need to pass `owner`/`repo` manually to individual methods inside.

**Important — all `mj.*` methods return Promises. Always `await` them:**

```js
// ✅ Correct
const result = await mj.core.recent({ limit: 5 })
return result.entries.map((e) => e.id)

// ❌ Wrong — returns a Promise object, not the entries
const result = mj.core.recent({ limit: 5 })

// ✅ Discovery
const help = await mj.help() // { groups, totalMethods, usage }
const groupHelp = await mj.core.help() // { group, methods }
```

**`mj.core.recent()` return shape**: Returns `{ entries: JournalEntry[], count: number }` — not a plain array. Access `.entries` to iterate:

```js
const { entries, count } = await mj.core.recent({ limit: 10 })
return entries.map((e) => ({ id: e.id, content: e.content.slice(0, 50) }))
```

<!-- SECTION:GITHUB -->

## GitHub Integration

- Include `issue_number`/`pr_number` in `create_entry` to auto-link
- After closing issue/merging PR → create summary entry with learnings
- CI failures → `actions-failure-digest` prompt or `memory://actions/recent`
- Kanban: `get_kanban_board` → `add_kanban_item` / `move_kanban_item` / `delete_kanban_item` → document completion (project_number auto-resolves if repo is registered)
- Milestones: `get_github_milestones` → track project progress, `memory://github/milestones`
- **Multi-Project Routing**: If `memory://briefing` shows "Registered Workspaces":
  - **Tools**: Pass a `repo` parameter to ALL GitHub tools (including `get_github_context`) to explicitly target a specific project.
  - **Resources**: You MUST use the dynamic `{repo}` variants for resources (e.g., `memory://github/status/{repo}`, `memory://github/insights/{repo}`) rather than the base URI (`memory://github/status`), which will fail with a detection error.
  - **Dynamic Briefings**: You can explicitly request the briefing for a specific project by reading `memory://briefing/{repo}` instead of the global `memory://briefing` resource.

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
