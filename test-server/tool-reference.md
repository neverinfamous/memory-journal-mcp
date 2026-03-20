# Tool Reference

Complete reference of all **44 tools** organized by 10 tool groups + codemode. Each group automatically includes Code Mode (`mj_execute_code`) for token-efficient operations.

> **3 tool shortcuts** (`starter`, `essential`, `readonly`) provide curated subsets for common use cases.
>
> Use [Tool Filtering](#️-tool-filtering) to select the groups you need. See [Code Mode](#-recommended-code-mode-maximum-token-savings) for the `mj.*` API that exposes every tool below through sandboxed JavaScript.

---

## codemode (1 tool)

Sandboxed JavaScript execution that exposes all 10 tool groups through the `mj.*` API.

| Tool               | Description                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mj_execute_code` | Execute JavaScript in a sandboxed environment with access to all journal tools via the `mj.*` API. Enables multi-step workflows in a single call, reducing token usage by 70-90%. API groups: `mj.core.*`, `mj.search.*`, `mj.analytics.*`, `mj.relationships.*`, `mj.export.*`, `mj.admin.*`, `mj.github.*`, `mj.backup.*`, `mj.team.*`. Use `mj.help()` for method listing. Returns the last expression value. |

---

## core (6 tools + Code Mode)

Entry lifecycle — create, retrieve, tags, and test.

| Tool                   | Description                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `create_entry`         | Create a new journal entry with context and tags (v2.1.0: GitHub Actions support).   |
| `get_entry_by_id`      | Get a specific journal entry by ID with full details.                                |
| `get_recent_entries`   | Get recent journal entries.                                                          |
| `create_entry_minimal` | Minimal entry creation without context or tags.                                      |
| `test_simple`          | Simple test tool that just returns a message.                                        |
| `list_tags`            | List all available tags.                                                             |

---

## search (4 tools + Code Mode)

Full-text, date-range, and semantic/vector search.

| Tool                     | Description                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_entries`         | Full-text search journal entries using FTS5 (supports phrases `"exact match"`, prefix `auth*`, boolean `NOT`/`OR`/`AND`, ranked by relevance). Optional filters for GitHub Projects, Issues, PRs, and Actions. |
| `search_by_date_range`   | Search journal entries within a date range with optional filters.                                                                                                                       |
| `semantic_search`        | Perform semantic/vector search on journal entries using AI embeddings.                                                                                                                  |
| `get_vector_index_stats` | Get statistics about the semantic search vector index.                                                                                                                                  |

---

## analytics (2 tools + Code Mode)

Statistics, cross-project insights, and analytics.

| Tool                        | Description                                                                     |
| --------------------------- | ------------------------------------------------------------------------------- |
| `get_statistics`            | Get journal statistics and analytics (Phase 2: includes project breakdown).     |
| `get_cross_project_insights`| Analyze patterns across all GitHub Projects tracked in journal entries.          |

---

## relationships (2 tools + Code Mode)

Link entries and visualize knowledge graphs.

| Tool                       | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `link_entries`             | Create a relationship between two journal entries.                  |
| `visualize_relationships`  | Generate a Mermaid diagram visualization of entry relationships.    |

---

## export (1 tool + Code Mode)

Export journal data in multiple formats.

| Tool              | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `export_entries`  | Export journal entries to JSON or Markdown format.    |

---

## admin (5 tools + Code Mode)

Entry mutations, vector index management, and tag maintenance.

| Tool                   | Description                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update_entry`         | Update an existing journal entry.                                                                                                                   |
| `delete_entry`         | Delete a journal entry (soft delete with timestamp).                                                                                                |
| `merge_tags`           | Merge one tag into another to consolidate similar tags (e.g., merge "phase-2" into "phase2"). The source tag is deleted after merge.                |
| `rebuild_vector_index` | Rebuild the semantic search vector index from all existing entries.                                                                                 |
| `add_to_vector_index`  | Add a specific entry to the semantic search vector index.                                                                                           |

---

## github (16 tools + Code Mode)

GitHub integration — Issues, PRs, context, Kanban boards, Milestones, Insights, issue lifecycle, and Copilot Reviews.

| Tool                            | Description                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `get_github_issues`             | List issues from a GitHub repository. Leave `owner`/`repo` empty to auto-detect from the current git repository.                         |
| `get_github_prs`                | List pull requests from a GitHub repository. Leave `owner`/`repo` empty to auto-detect from the current git repository.                  |
| `get_github_issue`              | Get detailed information about a specific GitHub issue. Leave `owner`/`repo` empty to auto-detect from the current git repository.       |
| `get_github_pr`                 | Get detailed information about a specific GitHub pull request. Leave `owner`/`repo` empty to auto-detect from the current git repository. |
| `get_github_context`            | Get current repository context including branch, open issues, and open PRs. Only counts OPEN items (closed items excluded).              |
| `get_kanban_board`              | View a GitHub Project v2 as a Kanban board with items grouped by Status column. Returns all columns with their items.                    |
| `move_kanban_item`              | Move a Kanban item to a different status column. Requires the project board to have a Status field.                                      |
| `create_github_issue_with_entry`| Create a GitHub issue AND automatically create a linked journal entry documenting the issue creation.                                    |
| `close_github_issue_with_entry` | Close a GitHub issue AND create a journal entry documenting the resolution.                                                              |
| `get_github_milestones`         | List GitHub milestones for the repository with completion percentages and due dates.                                                     |
| `get_github_milestone`          | Get detailed information about a specific GitHub milestone including progress and linked issue counts.                                   |
| `create_github_milestone`       | Create a new GitHub milestone for tracking progress toward a project goal.                                                               |
| `update_github_milestone`       | Update a GitHub milestone (title, description, due date, or state). Use state "closed" to close a completed milestone.                   |
| `delete_github_milestone`       | Permanently delete a GitHub milestone. Issues assigned to the milestone will be un-assigned but not deleted.                              |
| `get_repo_insights`             | Get repository insights: stars, forks, traffic (clones/views), referrers, and popular paths. Use "sections" to control token usage.      |
| `get_copilot_reviews`           | Get Copilot's code review findings for a pull request. Returns review state and file-level comments with paths and line numbers.          |

---

## backup (4 tools + Code Mode)

Database backup, restore, and retention management.

| Tool               | Description                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `backup_journal`   | Create a timestamped backup of the journal database. Backups are stored in the `backups/` directory.                        |
| `list_backups`     | List all available backup files with their sizes and creation dates.                                                        |
| `restore_backup`   | Restore the journal database from a backup file. WARNING: This replaces all current data. An automatic backup is created before restore. |
| `cleanup_backups`  | Delete old backup files, keeping only the most recent N backups. Use `list_backups` to preview before cleanup.              |

---

## team (3 tools + Code Mode)

Team collaboration with a separate shared database. Requires `TEAM_DB_PATH`.

| Tool                | Description                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| `team_create_entry` | Create an entry in the team database for sharing with collaborators.     |
| `team_get_recent`   | Get recent entries from the team database.                               |
| `team_search`       | Search entries in the team database by text and/or tags.                 |

---

## ⚙️ Tool Filtering

Control which tools are exposed via `MEMORY_JOURNAL_MCP_TOOL_FILTER` (or CLI: `--tool-filter`):

| Filter               | Tools | Use Case                 |
| -------------------- | ----- | ------------------------ |
| `full`               | 44    | All tools (default)      |
| `starter`            | ~10   | Core + search + codemode |
| `essential`          | ~6    | Minimal footprint        |
| `readonly`           | ~15   | Disable all mutations    |
| `-github`            | 28    | Exclude a group          |
| `-github,-analytics` | 26    | Exclude multiple groups  |

**Filter Syntax:** `shortcut` or `group` or `tool_name` (whitelist mode) · `-group` (disable group) · `-tool` (disable tool) · `+tool` (re-enable after group disable)

**Custom Selection:** List individual tool names to create your own whitelist: `--tool-filter "create_entry,search_entries,semantic_search"`

**Groups:** `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`, `team`, `codemode`

---

## 🌟 Recommended: Code Mode (Maximum Token Savings)

Code Mode (`mj_execute_code`) dramatically reduces token usage (70–90%) and is included by default in all presets.

Code executes in a **sandboxed VM context** with:

- **Static code validation** — blocked patterns include `require()`, `process`, `eval()`, and filesystem access
- **Rate limiting** — 60 executions per minute per client
- **Hard timeouts** — configurable execution limit (default 30s)
- **Full API access** — all 10 tool groups available via `mj.*`

**API Groups:** `mj.core.*`, `mj.search.*`, `mj.analytics.*`, `mj.relationships.*`, `mj.export.*`, `mj.admin.*`, `mj.github.*`, `mj.backup.*`, `mj.team.*`
