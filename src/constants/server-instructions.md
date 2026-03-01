<!-- SECTION:ESSENTIAL -->

# memory-journal-mcp

## Session Start

1. Read `memory://briefing` for project context
   - In Cursor, use `FetchMcpResource(server: "user-memory-journal-mcp", uri: "memory://briefing")`
2. **Show the `userMessage` to the user** (it contains a formatted summary of project context)
3. Proceed with the user's request

## Behaviors

- **Create entries for**: implementations, decisions, bug fixes, milestones, user requests to "remember"
- **Search before**: major decisions, referencing prior work, understanding project context
- **Link entries**: implementation→spec, bugfix→issue, followup→prior work

## Session End

When a conversation or task is wrapping up (user says "thanks," final deliverable complete, no more work planned):

1. Create a journal entry summarizing the session:
   - **What was accomplished** (key changes, decisions, files modified)
   - **What's unfinished or blocked** (pending items, open questions)
   - **Context for next session** (relevant entry IDs, branch names, PR numbers)
2. Use `entry_type: "retrospective"` and tag with `session-summary`
3. This is opt-out — create the entry by default unless the user asks you not to

> If your client has hooks configured for session-end journaling (e.g., Cursor `sessionEnd` hook), this is handled automatically. Otherwise, follow the steps above.

## Rule & Skill Suggestions

When you notice the user consistently applies patterns, preferences, or workflows that could be codified:

- **Offer to create a rule or skill** — always ask the user first, never create silently
- Examples: coding conventions, testing patterns, deployment steps, project-specific commands
- Frame it as: "I noticed you always [pattern]. Would you like me to save this as a rule/skill so future agents follow it automatically?"

## Quick Access

| Purpose         | Action                      |
| --------------- | --------------------------- |
| Session context | `memory://briefing`         |
| Recent entries  | `memory://recent`           |
| Health/time     | `memory://health`           |
| Semantic search | `semantic_search(query)`    |
| Full context    | `get-context-bundle` prompt |

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

### Calling Tools

Use `CallMcpTool` with server name `user-memory-journal-mcp`:

```
CallMcpTool(server: "user-memory-journal-mcp", toolName: "create_entry", arguments: {...})
```

### Listing Resources

Use `ListMcpResources` with server name:

```
ListMcpResources(server: "user-memory-journal-mcp")
```

Do NOT try to browse filesystem paths for MCP tool/resource definitions - use the MCP protocol directly.

### Fetching Resources

Use `FetchMcpResource` with server name and `memory://` URI:

```
FetchMcpResource(server: "user-memory-journal-mcp", uri: "memory://recent")
FetchMcpResource(server: "user-memory-journal-mcp", uri: "memory://kanban/1")
```

## Quick Health Check

Fetch `memory://health` to verify server status, database stats, and tool availability.

<!-- SECTION:TOOL_PARAMETER_REFERENCE -->

## Tool Parameter Reference

### Entry Operations

| Tool                   | Required Parameters | Optional Parameters                                                                                                                                                                                                                                            |
| ---------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_entry`         | `content` (string)  | `entry_type`, `tags` (array), `is_personal`, `significance_type`, `share_with_team`, `auto_context`, `issue_number`, `issue_url`, `pr_number`, `pr_url`, `pr_status`, `project_number`, `project_owner`, `workflow_run_id`, `workflow_name`, `workflow_status` |
| `create_entry_minimal` | `content` (string)  | none                                                                                                                                                                                                                                                           |
| `get_entry_by_id`      | `entry_id` (number) | `include_relationships` (bool, default true)                                                                                                                                                                                                                   |
| `get_recent_entries`   | none                | `limit` (default 5), `is_personal` (bool)                                                                                                                                                                                                                      |
| `update_entry`         | `entry_id` (number) | `content`, `tags`, `entry_type`, `is_personal`                                                                                                                                                                                                                 |
| `delete_entry`         | `entry_id` (number) | `permanent` (bool, default false)                                                                                                                                                                                                                              |
| `list_tags`            | none                | none                                                                                                                                                                                                                                                           |

### Search Tools

| Tool                     | Required Parameters                   | Optional Parameters                                                                                            |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `search_entries`         | none                                  | `query`, `limit`, `is_personal`, `issue_number`, `pr_number`, `pr_status`, `project_number`, `workflow_run_id` |
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
- **GitHub metadata in entries**: Entry output includes 10 GitHub fields (`issueNumber`, `issueUrl`, `prNumber`, `prUrl`, `prStatus`, `projectNumber`, `projectOwner`, `workflowRunId`, `workflowName`, `workflowStatus`) in all tool responses.
- **`delete_entry` on soft-deleted**: `delete_entry(id, permanent: true)` works on previously soft-deleted entries. Returns `success: false` for nonexistent entries.

## Key Resources

| URI                              | Description                                        |
| -------------------------------- | -------------------------------------------------- |
| `memory://health`                | Server health, DB stats, tool filter status        |
| `memory://briefing`              | Session context with userMessage to show user      |
| `memory://instructions`          | Full server instructions and tool reference        |
| `memory://statistics`            | Entry counts by type and period                    |
| `memory://recent`                | 10 most recent entries                             |
| `memory://tags`                  | All tags with usage counts                         |
| `memory://significant`           | Entries sorted by importance score                 |
| `memory://graph/recent`          | Mermaid diagram of recent relationships            |
| `memory://graph/actions`         | CI/CD narrative graph                              |
| `memory://actions/recent`        | Recent workflow runs                               |
| `memory://team/recent`           | Team-shared entries                                |
| `memory://github/status`         | GitHub repo overview (CI, issues, PRs, milestones) |
| `memory://github/milestones`     | Open milestones with completion %                  |
| `memory://github/insights`       | Stars, forks, and 14-day traffic summary           |
| `memory://kanban/{n}`            | Kanban board for project number n                  |
| `memory://kanban/{n}/diagram`    | Mermaid Kanban visualization                       |
| `memory://milestones/{n}`        | Single milestone detail + progress                 |
| `memory://projects/{n}/timeline` | Project entries timeline                           |
| `memory://issues/{n}/entries`    | Entries linked to issue n                          |
| `memory://prs/{n}/entries`       | Entries linked to PR n                             |
| `memory://prs/{n}/timeline`      | PR lifecycle and linked entries                    |
