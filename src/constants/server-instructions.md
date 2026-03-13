<!-- SECTION:ESSENTIAL -->

# memory-journal-mcp

## Session Start

1. Read `memory://briefing` for project context
   - **Server name for resource calls**: Derive from tool prefixes — strip the tool name suffix to get the server name.
     - **AntiGravity**: Tools are `mcp_{name}_{tool}` (e.g., `mcp_memory-journal-mcp_create_entry`). Server name = `memory-journal-mcp`.
     - **Cursor**: Tools are `user-{name}-{tool}` (e.g., `user-memory-journal-mcp-create_entry`). Server name = `user-memory-journal-mcp`.
     - **Other clients** (Claude Desktop, etc.): Likely use the configured name exactly (e.g., `memory-journal-mcp`). Only Cursor and AntiGravity have been verified — use the tool-prefix discovery method above if unsure.
2. Proceed with the user's request

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

| Group         | Namespace              | Example                                           |
|---------------|------------------------|---------------------------------------------------|
| Core          | `mj.core.*`           | `mj.core.createEntry("Implemented feature X")`    |
| Search        | `mj.search.*`         | `mj.search.searchEntries("performance")`          |
| Analytics     | `mj.analytics.*`      | `mj.analytics.getStatistics()`                    |
| Relationships | `mj.relationships.*`  | `mj.relationships.linkEntries(1, 2, "implements")`|
| Export        | `mj.export.*`         | `mj.export.exportEntries("json")`                 |
| Admin         | `mj.admin.*`          | `mj.admin.rebuildVectorIndex()`                   |
| GitHub        | `mj.github.*`         | `mj.github.getGithubIssues({ state: "open" })`   |
| Backup        | `mj.backup.*`         | `mj.backup.backupJournal()`                       |
| Team          | `mj.team.*`           | `mj.team.teamCreateEntry("Team update")`          |

**Features**: Positional args (`createEntry("note")`), aliases (`mj.core.create`), `mj.help()` for discovery.
**Returns**: Last expression value. Errors return `{ success: false, error: "..." }`.

<!-- SECTION:GITHUB -->

## GitHub Integration

- Include `issue_number`/`pr_number` in `create_entry` to auto-link
- After closing issue/merging PR → create summary entry with learnings
- CI failures → `actions-failure-digest` prompt or `memory://actions/recent`
- Kanban: `get_kanban_board(project_number)` → `move_kanban_item` → document completion
- Milestones: `get_github_milestones` → track project progress, `memory://github/milestones`
- GitHub tools auto-detect owner/repo from git context; specify explicitly if null

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

<!-- SECTION:TOOL_PARAMETER_REFERENCE -->

## Tool Parameter Reference

### Entry Operations

| Tool                   | Required Parameters | Optional Parameters                                                                                                                                                                                                                         |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_entry`         | `content` (string)  | `entry_type`, `tags` (array), `is_personal`, `significance_type`, `auto_context`, `issue_number`, `issue_url`, `pr_number`, `pr_url`, `pr_status`, `project_number`, `project_owner`, `workflow_run_id`, `workflow_name`, `workflow_status` |
| `create_entry_minimal` | `content` (string)  | none                                                                                                                                                                                                                                        |
| `get_entry_by_id`      | `entry_id` (number) | `include_relationships` (bool, default true)                                                                                                                                                                                                |
| `get_recent_entries`   | none                | `limit` (default 5), `is_personal` (bool)                                                                                                                                                                                                   |
| `update_entry`         | `entry_id` (number) | `content`, `tags`, `entry_type`, `is_personal`                                                                                                                                                                                              |
| `delete_entry`         | `entry_id` (number) | `permanent` (bool, default false)                                                                                                                                                                                                           |
| `list_tags`            | none                | none                                                                                                                                                                                                                                        |

### Search Tools

| Tool                     | Required Parameters                   | Optional Parameters                                                                                            |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `search_entries`         | none                                  | `query`, `limit`, `is_personal`, `issue_number`, `pr_number`, `pr_status`, `project_number`, `workflow_run_id`. Query uses FTS5: phrases `"exact match"`, prefix `auth*`, boolean `NOT`/`OR`/`AND`, ranked by BM25 relevance. |
| `search_by_date_range`   | `start_date`, `end_date` (YYYY-MM-DD) | `tags`, `entry_type`, `is_personal`, `issue_number`, `pr_number`, `project_number`, `workflow_run_id`          |
| `semantic_search`        | `query` (string)                      | `limit`, `similarity_threshold` (default 0.25), `is_personal`, `hint_on_empty` (bool, default true)            |
| `get_vector_index_stats` | none                                  | none                                                                                                           |

### Relationship Tools

| Tool                      | Required Parameters                      | Notes                                                                                                                                      |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `link_entries`            | `from_entry_id`, `to_entry_id` (numbers) | Types: `evolves_from`, `references`, `implements`, `clarifies`, `response_to`, `blocked_by`, `resolved`, `caused`. Optional `description`. |
| `visualize_relationships` | none                                     | Optional `entry_id`, `tags` (array), `depth` (1-3, default 2), `limit` (default 20). Returns Mermaid diagram.                              |

### GitHub Tools

| Tool                 | Required Parameters     | Notes                                                                                                                        |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `get_github_context` | none                    | Returns repo info, open issues/PRs. Only counts OPEN items.                                                                  |
| `get_github_issues`  | none                    | Optional `state` (open/closed/all), `limit`, `owner`, `repo`                                                                 |
| `get_github_prs`     | none                    | Optional `state`, `limit`, `owner`, `repo`                                                                                   |
| `get_github_issue`   | `issue_number` (number) | Optional `owner`, `repo`. Fetches single issue details.                                                                      |
| `get_github_pr`      | `pr_number` (number)    | Optional `owner`, `repo`. Fetches single PR details.                                                                         |
| `get_repo_insights`  | none                    | Optional `sections` (stars/traffic/referrers/paths/all, default "stars"), `owner`, `repo`. Requires push access for traffic. |

GitHub tools auto-detect owner/repo from GITHUB_REPO_PATH. If `detectedOwner`/`detectedRepo` are null in response, specify `owner` and `repo` parameters explicitly.

### Issue Lifecycle Tools

| Tool                             | Required Parameters     | Notes                                                                                                                                                    |
| -------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_github_issue_with_entry` | `title` (string)        | Optional `body`, `labels` (array), `assignees` (array), `project_number`, `initial_status`, `milestone_number`, `entry_content`, `tags`, `owner`, `repo` |
| `close_github_issue_with_entry`  | `issue_number` (number) | Optional `comment`, `resolution_notes`, `tags`, `move_to_done` (bool), `project_number`, `owner`, `repo`                                                 |

### Kanban Tools (GitHub Projects v2)

| Tool               | Required Parameters                                            | Notes                                                                                                     |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `get_kanban_board` | `project_number` (number)                                      | Optional `owner`. Returns columns with items grouped by Status                                            |
| `move_kanban_item` | `project_number`, `item_id` (string), `target_status` (string) | Optional `owner`. `item_id` is the GraphQL node ID from board items. Status matching is case-insensitive. |

**Finding the right project**: User may have multiple projects. Use `get_kanban_board` with different project numbers (1, 2, 3...) to find the correct one by checking `projectTitle`.

**Default Status columns** (typical GitHub Projects v2):

- `Backlog` - Items not yet started
- `Ready` - Ready to be picked up
- `In progress` - Actively being worked on
- `In review` - In review
- `Done` - Completed

Note: Status columns are dynamic per project. The `statusOptions` in the response shows available statuses for that specific project.

Kanban resources:

- `memory://kanban/{project_number}` - JSON board data
- `memory://kanban/{project_number}/diagram` - Mermaid visualization

### Milestone Tools

| Tool                      | Required Parameters                 | Notes                                                                             |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| `get_github_milestones`   | none                                | Optional `state` (open/closed/all), `limit`, `owner`, `repo`                      |
| `get_github_milestone`    | `milestone_number` (number)         | Optional `owner`, `repo`. Single milestone with completion %.                     |
| `create_github_milestone` | `title` (string)                    | Optional `description`, `due_on` (YYYY-MM-DD), `owner`, `repo`                    |
| `update_github_milestone` | `milestone_number` (number)         | Optional `title`, `description`, `due_on`, `state` (open/closed), `owner`, `repo` |
| `delete_github_milestone` | `milestone_number`, `confirm: true` | Optional `owner`, `repo`. Permanent deletion.                                     |

Milestone resources:

- `memory://github/milestones` - Open milestones with completion %
- `memory://milestones/{number}` - Single milestone detail

### Admin Tools

| Tool                   | Required Parameters         | Notes                                                                        |
| ---------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `backup_journal`       | none                        | Optional `name` (custom backup name)                                         |
| `list_backups`         | none                        | Returns available backup files                                               |
| `cleanup_backups`      | none                        | Optional `keep_count` (default 5). Deletes old backups, keeps N most recent. |
| `restore_backup`       | `filename`, `confirm: true` | Creates auto-backup before restore                                           |
| `add_to_vector_index`  | `entry_id` (single number)  | Indexes one entry for semantic search                                        |
| `rebuild_vector_index` | none                        | Re-indexes all entries                                                       |

### Export Tools

| Tool             | Required Parameters | Notes                                                                                                     |
| ---------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| `export_entries` | none                | Optional `format` (json/markdown), `limit` (default 100), `tags`, `start_date`, `end_date`, `entry_types` |

### Code Mode

| Tool                | Required Parameters | Optional Parameters                                     |
| ------------------- | ------------------- | ------------------------------------------------------- |
| `mj_execute_code`   | `code` (string)     | `timeout` (ms, max 30000), `readonly` (bool, default false) |

## Entry Types

Valid values for `entry_type` parameter:

- `personal_reflection` (default) - Personal thoughts and notes
- `project_decision` - Architectural and team decisions
- `technical_achievement` - Milestones and breakthroughs
- `bug_fix` - Bug fixes and resolutions
- `feature_implementation` - Feature builds and rollouts
- `code_review` - Code review notes
- `meeting_notes` - Meeting summaries
- `learning` - Learning and research insights
- `research` - Research and exploration
- `planning` - Planning sessions and roadmaps (`create_github_issue_with_entry` uses this type)
- `retrospective` - Sprint and project retrospectives
- `standup` - Daily standup notes
- `technical_note` - Technical notes and observations
- `development_note` - Development process notes
- `enhancement` - Enhancement tracking
- `milestone` - Milestone documentation
- `system_integration_test` - Integration test records
- `test_entry` - Test and scratch entries
- `other` - Miscellaneous

## Field Notes

- **`autoContext`**: Reserved for future automatic context capture. Currently always `null`.
- **`memory://tags` vs `list_tags`**: Resource includes `id`, `name`, `count`; tool returns only `name`, `count`. Neither returns orphan tags with zero usage.
- **Tag naming**: Use lowercase with dashes (e.g., `bug-fix`, `phase-2`). Use `merge_tags` to consolidate duplicates (e.g., merge `phase2` into `phase-2`).
- **`merge_tags` behavior**: Only updates non-deleted entries. Deleted entries retain their original tags.
- **`prStatus` in entries**: Reflects PR state at entry creation time, not current state. Use `get_github_pr` for live status.
- **`restore_backup` behavior**: Restores entire database state. Any recent changes (new entries, tag merges via `merge_tags`, relationships) are reverted. A pre-restore backup is automatically created for safety.
- **Semantic search indexing**: Entries are auto-indexed on creation (fire-and-forget). If index count drifts from DB count, use `rebuild_vector_index` or enable `AUTO_REBUILD_INDEX=true` for automatic reconciliation on server startup.
- **`semantic_search` thresholds**: Default similarity threshold is 0.25. For broader matches, try 0.15-0.2. Higher values (0.4+) return only very close semantic matches.
- **Causal relationship types**: Use `blocked_by` (A was blocked by B), `resolved` (A resolved B), `caused` (A caused B) for decision tracing and failure analysis. Visualizations use distinct arrow styles for causal types.
- **Enhanced analytics**: `get_statistics` returns `decisionDensity` (significant entries per period), `relationshipComplexity` (avg relationships per entry), `activityTrend` (period-over-period growth %), and `causalMetrics` (counts for blocked_by/resolved/caused).
- **Importance scores**: `get_entry_by_id` returns `importance` (0.0-1.0) and `importanceBreakdown` showing weighted components: significance (30%), relationships (35%), causal (20%), recency (15%). `memory://significant` sorts entries by importance.
- **`inactiveThresholdDays`**: `get_cross_project_insights` includes `inactiveThresholdDays: 7` in output, documenting the inactive project classification cutoff.
- **`search_entries` FTS5 query syntax**: Uses FTS5 full-text search with Porter stemmer. Phrase queries: `"error handling"`. Prefix: `auth*`. Boolean: `deploy OR release`, `error NOT warning`. Word-boundary matching ("log" matches "log" but not "catalog"). Results ranked by BM25 relevance. Falls back to LIKE substring matching for queries with unbalanced quotes or special characters.
- **GitHub metadata in entries**: Entry output includes 10 GitHub fields (`issueNumber`, `issueUrl`, `prNumber`, `prUrl`, `prStatus`, `projectNumber`, `projectOwner`, `workflowRunId`, `workflowName`, `workflowStatus`) in all tool responses.
- **`delete_entry` on soft-deleted**: `delete_entry(id, permanent: true)` works on previously soft-deleted entries. Returns `success: false` for nonexistent entries.

## Key Resources

| URI                       | Description                                   |
| ------------------------- | --------------------------------------------- |
| `memory://health`         | Server health, DB stats, tool filter status   |
| `memory://briefing`       | Session context with userMessage to show user |
| `memory://instructions`   | Full server instructions and tool reference   |
| `memory://statistics`     | Entry counts by type and period               |
| `memory://recent`         | 10 most recent entries                        |
| `memory://tags`           | All tags with usage counts                    |
| `memory://significant`    | Entries sorted by importance score            |
| `memory://graph/recent`   | Mermaid diagram of recent relationships       |
| `memory://graph/actions`  | CI/CD narrative graph                         |
| `memory://actions/recent` | Recent workflow runs                          |

| `memory://github/status` | GitHub repo overview (CI, issues, PRs, milestones) |
| `memory://github/milestones` | Open milestones with completion % |
| `memory://github/insights` | Stars, forks, and 14-day traffic summary |
| `memory://kanban/{n}` | Kanban board for project number n |
| `memory://kanban/{n}/diagram` | Mermaid Kanban visualization |
| `memory://milestones/{n}` | Single milestone detail + progress |
| `memory://projects/{n}/timeline` | Project entries timeline |
| `memory://issues/{n}/entries` | Entries linked to issue n |
| `memory://prs/{n}/entries` | Entries linked to PR n |
| `memory://prs/{n}/timeline` | PR lifecycle and linked entries |
