# Tool Reference

Complete reference of all **105 tools** organized by 11 tool groups. Each group automatically includes Code Mode (`mj_execute_code`) for token-efficient operations.

> **3 tool shortcuts** (`starter`, `essential`, `readonly`) provide curated subsets for common use cases.
>
> Use [Tool Filtering](#️-tool-filtering) to select the groups you need. See [Code Mode](#-recommended-code-mode-maximum-token-savings) for the `mj.*` API that exposes every tool below through sandboxed JavaScript.

> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.

---

## codemode (1 tool)

Sandboxed JavaScript execution that exposes all 10 tool groups through the `mj.*` API.

| Tool              | Description                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mj_execute_code` | Execute JavaScript in a sandboxed environment with access to all journal tools via the `mj.*` API. Enables multi-step workflows in a single call, reducing token usage by 70-90%. API groups: `mj.core.*` (or `journal.*`), `mj.search.*`, `mj.analytics.*`, `mj.relationships.*`, `mj.export.*`, `mj.admin.*`, `mj.github.*`, `mj.backup.*`, `mj.team.*`. Use `mj.help()` for method listing. Aliases: `query` (search, q), `output_dir` (path, filepath), `keep_count` (keep), `target_user` (user, assignee), `flag_type` (severity), `workspace_id` (team, project). Returns the last expression value. |

---

## core (9 tools + Code Mode)

Entry lifecycle — create, retrieve, tags, and test.

| Tool                   | Description                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `create_entry`         | Create a new journal entry with context and tags. Supports `workspace_id` for multi-tenancy. |
| `get_entry_by_id`      | Get a specific journal entry by ID with full details.                              |
| `get_recent_entries`   | Get recent journal entries. Supports `sort_by` (timestamp or importance), cursor pagination, and `workspace_id`.          |
| `get_entry_history`    | Get the revision history of a specific journal entry (capped at 10 revisions).     |
| `test_simple`          | Simple test tool that just returns a message.                                      |
| `test_error_handling`  | Test tool for validating error handler responses.                                  |
| `trigger_progress`     | Test tool to trigger an MCP progress notification sequence.                        |
| `list_tags`            | List all available tags.                                                           |
| `mark_anchors_stale`   | Mark explicit relationships between entries as stale or out-of-date.               |

---

## search (6 tools + Code Mode)

Full-text, date-range, and semantic/vector search.

| Tool                     | Description                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_entries`         | Search journal entries. Use `mode` (`auto`, `fts`, `semantic`, `hybrid`). Supports `workspace_id`, filters, `sort_by`, cursor pagination, facets, and highlights. |
| `search_by_date_range`   | Search journal entries within a date range with optional filters, `workspace_id`, `sort_by`, and cursor pagination.                                                                                                |
| `semantic_search`        | Perform semantic/vector search on journal entries using AI embeddings.                                                                                                                                   |
| `get_vector_index_stats` | Get statistics about the semantic search vector index.                                                                                                                                                   |
| `list_deleted_entries`   | List recently soft-deleted entries that can be restored.                                                                                                                                                 |
| `cross_team_search`      | Search across multiple configured team databases simultaneously. Returns results with team_db labels. Read-only and degrades gracefully. |

---

## analytics (2 tools + Code Mode)

Statistics, cross-project insights, and analytics.

| Tool                         | Description                                                                 |
| ---------------------------- | --------------------------------------------------------------------------- |
| `get_statistics`             | Get journal statistics and analytics (supports `workspace_id` filtering). |
| `get_cross_project_insights` | Analyze patterns across all GitHub Projects tracked in journal entries.     |

---

## relationships (2 tools + Code Mode)

Link entries and visualize knowledge graphs.

| Tool                      | Description                                                      |
| ------------------------- | ---------------------------------------------------------------- |
| `link_entries`            | Create a relationship between two journal entries.               |
| `visualize_relationships` | Generate a Mermaid diagram visualization of entry relationships. |

---

## io (4 tools + Code Mode)

Export and import journal data in multiple formats, including Markdown roundtripping.

| Tool              | Description                                                                |
| ----------------- | -------------------------------------------------------------------------- |
| `export_entries`  | Export journal entries to JSON or Markdown format.                         |
| `export_markdown` | Export the entire journal to a structured directory of Markdown files.     |
| `import_markdown` | Import a structured directory of Markdown files into the journal database. |
| `import_external` | Import knowledge management exports (Notion, Obsidian, Logseq) into the journal. normalizes wikilinks, YAML frontmatter, and block hierarchies. |

---

## admin (12 tools + Code Mode)

Entry mutations, vector index management, tag maintenance, and audit log search.

| Tool                   | Description                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update_configuration` | Dynamically update the running server configuration (e.g., briefing depth, token limits) without restarting.                                                           |
| `update_entry`         | Update an existing journal entry (content, type, tags, and 14 metadata fields including trust, impact, significance, project, issue, PR, and workflow). Pass `expected_version` for optimistic locking. Pass `null` to clear a field. |
| `delete_entry`         | Delete a journal entry (soft delete with timestamp).                                                                                                                   |
| `restore_entry`        | Restore a soft-deleted journal entry.                                                                                                                                  |
| `merge_tags`           | Merge one tag into another to consolidate similar tags (e.g., merge "phase-2" into "phase2"). The source tag is deleted after merge.                                   |
| `rebuild_vector_index` | Rebuild the semantic search vector index from all existing entries.                                                                                                    |
| `add_to_vector_index`  | Add a specific entry to the semantic search vector index.                                                                                                              |
| `batch_create_entries` | Create multiple journal entries at once (Max 50 per batch). Ideal for data imports or bulk processing.                                                                  |
| `batch_update_entries` | Update multiple existing journal entries in a single transaction (Max 50 per batch). Pass `expected_version` per entry for optimistic locking.                                                                                    |
| `batch_delete_entries` | Delete multiple existing journal entries in a single transaction (Max 50 per batch).                                                                                    |
| `run_auto_prune`       | Manually trigger the auto-prune background job to soft-delete or hard-delete stale entries based on importance thresholds and configured intervals.                    |
| `search_audit_log`     | Search operational telemetry audit logs by tool name, user, date range, status, or category. Returns the most recent matches up to the limit.                          |

---

## github (18 tools + Code Mode)

GitHub integration — Issues, PRs, context, Kanban boards, Milestones, Insights, issue lifecycle, and Copilot Reviews.

| Tool                             | Description                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `get_github_issues`              | List issues from a GitHub repository. Leave `owner`/`repo` empty to auto-detect from the current git repository.                          |
| `get_github_prs`                 | List pull requests from a GitHub repository. Leave `owner`/`repo` empty to auto-detect from the current git repository.                   |
| `get_github_issue`               | Get detailed information about a specific GitHub issue. Leave `owner`/`repo` empty to auto-detect from the current git repository.        |
| `get_github_pr`                  | Get detailed information about a specific GitHub pull request. Leave `owner`/`repo` empty to auto-detect from the current git repository. |
| `get_github_context`             | Get current repository context including branch, open issues, and open PRs. Only counts OPEN items (closed items excluded).               |
| `get_kanban_board`               | View a GitHub Project v2 as a Kanban board with items grouped by Status column. Returns all columns with their items.                     |
| `move_kanban_item`               | Move a Kanban item to a different status column. Requires the project board to have a Status field.                                       |
| `add_kanban_item`                | Attach an existing GitHub issue to a GitHub Project v2 Kanban board as an item.                                                           |
| `delete_kanban_item`             | Remove an item from a GitHub Project v2 Kanban board without deleting the underlying issue.                                               |
| `create_github_issue_with_entry` | Create a GitHub issue AND automatically create a linked journal entry documenting the issue creation.                                     |
| `close_github_issue_with_entry`  | Close a GitHub issue AND create a journal entry documenting the resolution.                                                               |
| `get_github_milestones`          | List GitHub milestones for the repository with completion percentages and due dates.                                                      |
| `get_github_milestone`           | Get detailed information about a specific GitHub milestone including progress and linked issue counts.                                    |
| `create_github_milestone`        | Create a new GitHub milestone for tracking progress toward a project goal.                                                                |
| `update_github_milestone`        | Update a GitHub milestone (title, description, due date, or state). Use state "closed" to close a completed milestone.                    |
| `delete_github_milestone`        | Permanently delete a GitHub milestone. Issues assigned to the milestone will be un-assigned but not deleted.                              |
| `get_repo_insights`              | Get repository insights: stars, forks, traffic (clones/views), referrers, and popular paths. Use "sections" to control token usage.       |
| `get_copilot_reviews`            | Get Copilot's code review findings for a pull request. Returns review state and file-level comments with paths and line numbers.          |

---

## git (6 tools + Code Mode)

Commit history mining, release tracking, and commit analytics using `simple-git`.

| Tool                      | Description                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `get_commit_history`      | Fetch the commit history of the repository (with optional range or limit).                                                                 |
| `search_commits`          | Search commit messages or authors within the repository.                                                                                  |
| `get_release_info`        | Retrieve information about a specific release tag, including commit count and timestamp.                                                   |
| `get_unreleased_commits`  | Track commits that have been merged since the last release tag.                                                                            |
| `analyze_commit_patterns` | Analyze commit history to identify frequent contributors and frequently modified files.                                                    |
| `check_entry_staleness`   | Evaluate journal entry staleness by cross-referencing with recent git commits or branch activity.                                          |

---

## backup (4 tools + Code Mode)

Database backup, restore, and retention management.

| Tool              | Description                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `backup_journal`  | Create a timestamped backup of the journal database. Backups are stored in the `backups/` directory.                                     |
| `list_backups`    | List all available backup files with their sizes and creation dates.                                                                     |
| `restore_backup`  | Restore the journal database from a backup file. WARNING: This replaces all current data. An automatic backup is created before restore. |
| `cleanup_backups` | Delete old backup files, keeping only the most recent N backups. Use `list_backups` to preview before cleanup.                           |

---

## team (39 tools + Code Mode)

Team collaboration with a separate shared database. Requires `TEAM_DB_PATH`.

### Core

| Tool                   | Description                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `team_create_entry`    | Create an entry in the team database for sharing with collaborators.                            |
| `team_get_entry_by_id` | Get a specific team entry by ID with full details including relationships and importance score. |
| `team_get_recent`      | Get recent entries from the team database. Supports `sort_by` (timestamp or importance) and cursor pagination.        |
| `team_list_tags`       | List all tags used in the team database with usage counts.                                      |

### Search

| Tool                        | Description                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `team_search`               | Search team entries. Use `mode` (`auto`, `fts`, `semantic`, `hybrid`) to control strategy. Supports `sort_by` (timestamp or importance), cursor pagination, `include_facets`, `include_highlights`, hybrid search weights, `fuzzy_match` (typo tolerance), and `auto_correct`. |
| `team_search_by_date_range` | Search team entries within a date range with optional filters, `sort_by` (timestamp or importance), and cursor pagination. |
| `team_list_deleted_entries` | List recently soft-deleted team entries that can be restored. Requires TEAM_DB_PATH. |

### Admin

| Tool                | Description                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `team_update_entry` | Update a team entry (content, type, tags, and 14 metadata fields including trust, impact, significance, project, issue, PR, and workflow). Pass `expected_version` for optimistic locking. Pass `null` to clear a field. |
| `team_delete_entry` | Soft-delete a team entry (marks as deleted, preservable).                                                                                                 |
| `team_restore_entry`| Restore a soft-deleted team entry. Requires TEAM_DB_PATH.                                                                                                 |
| `team_merge_tags`   | Merge a source tag into a target tag in the team database.                                                                                                |
| `team_batch_create_entries` | Create multiple team journal entries at once (Max 50 per batch). Ideal for data imports or bulk processing.                                                                  |
| `team_batch_update_entries` | Update multiple existing team journal entries in a single transaction (Max 50 per batch). Pass `expected_version` per entry for optimistic locking.                                                                                    |
| `team_batch_delete_entries` | Delete multiple existing team journal entries in a single transaction (Max 50 per batch).                                                                                    |

### Analytics

| Tool                              | Description                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `team_get_statistics`             | Get statistics for the team database including entry counts, types, top tags, and contributor breakdown.    |
| `team_get_cross_project_insights` | Analyze patterns across all GitHub Projects tracked in team entries. Requires TEAM_DB_PATH.                 |
| `team_get_collaboration_matrix`   | Generate a structural matrix mapping author activity and cross-collaboration impact. Requires TEAM_DB_PATH. |

### Relationships

| Tool                           | Description                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| `team_link_entries`            | Create a relationship between two team entries.                        |
| `team_visualize_relationships` | Generate a Mermaid diagram showing relationships between team entries. |

### IO

| Tool                   | Description                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `team_export_entries`  | Export team entries in JSON or Markdown format with optional date range, type, and tag filters. |
| `team_export_markdown` | Export team journal to a structured directory of Markdown files.                                |
| `team_import_markdown` | Import team entries from a structured directory of Markdown files.                              |
| `team_import_external` | Import knowledge management exports (Notion, Obsidian, Logseq) into the team journal.           |

### Backup

| Tool                | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `team_backup`       | Create a timestamped backup of the team database.      |
| `team_list_backups` | List all available backup files for the team database. |

### Vector

| Tool                          | Description                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `team_semantic_search`        | Perform semantic/vector search on team entries using AI embeddings. Requires TEAM_DB_PATH.                |
| `team_get_vector_index_stats` | Get statistics about the team vector search index (item count, model, dimensions). Requires TEAM_DB_PATH. |
| `team_rebuild_vector_index`   | Rebuild the team semantic search vector index from all existing team entries. Requires TEAM_DB_PATH.      |
| `team_add_to_vector_index`    | Add a specific team entry to the semantic search vector index. Requires TEAM_DB_PATH.                     |


### Members

| Tool                        | Description                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `team_add_member`           | Add a new member to the team with a specified role (viewer, member, admin). Admins only.                                                                  |
| `team_remove_member`        | Remove a member from the team. Admins only.                                                                                                               |
| `team_update_member_role`   | Update the role of an existing team member. Admins only.                                                                                                  |
| `team_list_members`         | List all team members and their roles.                                                                                                                    |
| `team_get_member`           | Get details about a specific team member by their author name.                                                                                            |

### Aliases

| Tool                       | Description                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `team_add_author_alias`    | Map an alternate author name (alias) to a canonical author identity in the team database. Admins only.                                                    |
| `team_remove_author_alias` | Remove an existing author alias mapping. Admins only.                                                                                                     |
| `team_list_author_aliases` | List all author aliases and their canonical mappings.                                                                                                     |
| `team_resolve_author`      | Resolve a given author name to its canonical identity based on existing aliases. Returns the original name if no alias exists.                            |
| `team_consolidate_authors` | Retroactively update existing team entries and relationships to use the canonical author name for a given alias or canonical target. Admins only.         |

---

## ⚙️ Tool Filtering

Control which tools are exposed via `MEMORY_JOURNAL_MCP_TOOL_FILTER` (or CLI: `--tool-filter`):

| Filter               | Tools | Use Case                 |
| -------------------- | ----- | ------------------------ |
| `full`               | 105   | All tools (default)      |
| `starter`            | 15    | Core + search + codemode |
| `essential`          | 9     | Minimal footprint        |
| `readonly`           | 23    | Disable all mutations    |
| `-github`            | 82    | Exclude a group          |
| `-github,-analytics` | 80    | Exclude multiple groups  |

**Filter Syntax:** `shortcut` or `group` or `tool_name` (whitelist mode) · `-group` (disable group) · `-tool` (disable tool) · `+tool` (re-enable after group disable)

**Custom Selection:** List individual tool names to create your own whitelist: `--tool-filter "create_entry,search_entries,semantic_search"`

**Groups:** `core`, `search`, `analytics`, `relationships`, `io`, `admin`, `github`, `backup`, `team`, `codemode`

---

## 🌟 Recommended: Code Mode (Maximum Token Savings)

Code Mode (`mj_execute_code`) dramatically reduces token usage (70–90%) and is included by default in all presets.

Code executes in a **sandboxed VM context** with:

- **Static code validation** — blocked patterns include `require()`, `process`, `eval()`, and filesystem access
- **Rate limiting** — 60 executions per minute per client
- **Hard timeouts** — configurable execution limit (default 30s)
- **Full API access** — all 10 tool groups available via `mj.*`

**API Groups:** `mj.core.*` (also aliased as `journal.*`), `mj.search.*`, `mj.analytics.*`, `mj.relationships.*`, `mj.io.*`, `mj.admin.*`, `mj.github.*`, `mj.backup.*`, `mj.team.*`
