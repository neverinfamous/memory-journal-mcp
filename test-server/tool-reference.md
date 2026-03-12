# Tool Reference

Complete reference of all **44 tools** organized by 11 tool groups.

> Every tool returns structured `{success, error}` responses — no raw exceptions, no silent failures.
>
> Use [Tool Filtering](Tool-Filtering) to select the groups you need. See the README for details.

---

## Code Mode (1 tool)

> 🌟 **Recommended** — Sandboxed JavaScript execution that exposes all 44 tools via the `mj.*` API. Reduces token overhead by up to 90%.

| Tool | Description |
| ---- | ----------- |
| `mj_execute_code` | Execute JavaScript code in a secure sandbox with full access to all tool groups via `mj.*` API. Supports `timeout` (default: 30s), `readonly` mode, and positional argument shortcuts. |

---

## Core (6 tools)

Entry CRUD, tag listing, and connectivity test.

| Tool | Description |
| ---- | ----------- |
| `create_entry` | Create a journal entry with content, tags, entry type, and optional GitHub context (project, issue, PR, workflow). Supports `share_with_team` for team DB sync. |
| `get_entry_by_id` | Get a specific journal entry by ID with full details, importance score, and optional relationships. |
| `get_recent_entries` | Get recent journal entries with optional `limit` (default: 5) and personal/project filter. |
| `create_entry_minimal` | Create a journal entry with content only — no tags, type, or context fields. |
| `test_simple` | Simple connectivity test that echoes a message back. |
| `list_tags` | List all tags with their usage counts. |

---

## Search (4 tools)

Text search, date-range queries, semantic/vector search, and index statistics.

| Tool | Description |
| ---- | ----------- |
| `search_entries` | Search journal entries by text query with optional filters for project, issue, PR, and personal/project scope. Merges results from team DB when available. |
| `search_by_date_range` | Search journal entries within a start/end date range with optional filters for entry type, tags, project, issue, PR, and workflow. |
| `semantic_search` | Perform semantic/vector search on journal entries using AI embeddings. Supports `similarity_threshold` tuning and returns similarity scores. |
| `get_vector_index_stats` | Get statistics about the semantic search vector index (item count, model name, dimensions). |

---

## Analytics (2 tools)

Journal statistics, activity trends, and cross-project insights.

| Tool | Description |
| ---- | ----------- |
| `get_statistics` | Get journal statistics: entries by type, period-grouped activity, decision density, relationship complexity, and activity trends. Supports `project_breakdown` for per-project counts. |
| `get_cross_project_insights` | Analyze patterns across all GitHub Projects tracked in journal entries — per-project stats, top tags, inactive project detection, and time distribution. |

---

## Relationships (2 tools)

Entry linking with typed relationships and Mermaid diagram visualization.

| Tool | Description |
| ---- | ----------- |
| `link_entries` | Create a typed relationship between two journal entries. Types: `references`, `evolves_from`, `implements`, `clarifies`, `response_to`, `blocked_by`, `resolved`, `caused`. Deduplicates existing links. |
| `visualize_relationships` | Generate a Mermaid diagram visualization of entry relationships. Filter by entry ID, tags, or view all linked entries. Supports traversal depth control. |

---

## Export (1 tool)

Data export in JSON or Markdown format.

| Tool | Description |
| ---- | ----------- |
| `export_entries` | Export journal entries to JSON or Markdown format. Supports date range, entry type, tag filters, and configurable limit (default: 100). |

---

## Admin (5 tools)

Entry updates, deletion, tag management, and vector index operations.

| Tool | Description |
| ---- | ----------- |
| `update_entry` | Update an existing journal entry (content, type, personal flag, tags). Auto re-indexes to vector store when content changes. |
| `delete_entry` | Delete a journal entry (soft delete with timestamp by default, `permanent: true` for hard delete). |
| `merge_tags` | Merge one tag into another to consolidate similar tags. The source tag is removed after merge. |
| `rebuild_vector_index` | Rebuild the semantic search vector index from all existing entries. Reports progress during long operations. |
| `add_to_vector_index` | Add a specific entry to the semantic search vector index by entry ID. |

---

## GitHub (16 tools)

> GitHub integration — issues, PRs, Kanban boards, milestones, and repository insights. Auto-detects `owner/repo` from the local git repository.

### Read (5 tools)

| Tool | Description |
| ---- | ----------- |
| `get_github_issues` | List issues from a GitHub repository. Auto-detects owner/repo from git. |
| `get_github_prs` | List pull requests from a GitHub repository. Auto-detects owner/repo from git. |
| `get_github_issue` | Get detailed information about a specific GitHub issue by number. |
| `get_github_pr` | Get detailed information about a specific GitHub pull request by number. |
| `get_github_context` | Get current repository context: branch, commit, remote URL, open issues, and open PRs. |

### Kanban (2 tools)

| Tool | Description |
| ---- | ----------- |
| `get_kanban_board` | View a GitHub Project v2 as a Kanban board with items grouped by Status column. |
| `move_kanban_item` | Move a Kanban item to a different status column by item ID and target status name. |

### Issue Lifecycle (2 tools)

| Tool | Description |
| ---- | ----------- |
| `create_github_issue_with_entry` | Create a GitHub issue AND automatically create a linked journal entry. Optionally adds to a Project board with initial status. |
| `close_github_issue_with_entry` | Close a GitHub issue AND create a journal entry documenting the resolution. Optionally moves the Kanban item to "Done". |

### Milestones (5 tools)

| Tool | Description |
| ---- | ----------- |
| `get_github_milestones` | List GitHub milestones with completion percentages and due dates. |
| `get_github_milestone` | Get detailed milestone information including progress and linked issue counts. |
| `create_github_milestone` | Create a new GitHub milestone with title, description, and optional due date. |
| `update_github_milestone` | Update a milestone (title, description, due date, state). Use `state: "closed"` to close. |
| `delete_github_milestone` | Permanently delete a milestone. Assigned issues are un-assigned but not deleted. |

### Insights (1 tool)

| Tool | Description |
| ---- | ----------- |
| `get_repo_insights` | Get repository insights: stars, forks, traffic, referrers, and popular paths. Use `sections` to control token usage (~50–350 tokens). |

### Copilot (1 tool)

| Tool | Description |
| ---- | ----------- |
| `get_copilot_reviews` | Get Copilot's code review findings for a PR — review state, file-level comments with paths and line numbers. Use to learn from review patterns and create `copilot-finding` journal entries. |

---

## Backup (4 tools)

Timestamped backup/restore with automatic pre-restore snapshots.

| Tool | Description |
| ---- | ----------- |
| `backup_journal` | Create a timestamped backup of the journal database. Stored in the `backups/` directory. |
| `list_backups` | List all available backup files with sizes and creation dates. |
| `restore_backup` | Restore the journal database from a backup file. WARNING: Replaces all current data. An automatic backup is created before restore. |
| `cleanup_backups` | Delete old backups, keeping only the most recent N (default: 5). Use `list_backups` to preview. |

---

## Team (3 tools)

> Shared team database for multi-user collaboration. Requires `TEAM_DB_PATH` environment variable.

| Tool | Description |
| ---- | ----------- |
| `team_create_entry` | Create an entry in the team database with automatic author detection (TEAM_AUTHOR env → git config → "unknown"). |
| `team_get_recent` | Get recent entries from the team database with author attribution. |
| `team_search` | Search team database entries by text and/or tags with author attribution. |

---

## See Also

- [[Tool-Filtering]] — Reduce tool count to fit IDE limits
- [[Configuration]] — MCP client configuration

---

_Updated for v5.2.0 — March 12, 2026_
