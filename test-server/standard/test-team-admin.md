
# Re-Test memory-journal-mcp — Team Admin, Analytics & IO

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `admin`, `team`, `codemode`
- **Validation:** Ensure strict mode and boundary limits.
- **Use direct MCP tools exclusively.**
- Seed data from `test-seed.md` must be present.
- `TEAM_DB_PATH` configured.

---

## Phase 14B: Team Admin & Analytics
### 14.7 Team Admin & Recovery

| Test                     | Command/Action                                                                          | Expected Result                                      |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Update content           | `team_update_entry(project_number: 5, entry_id: <id>, content: "Updated team content")` | `success: true`, `entry` with updated content        |
| Update omit project_no   | `team_update_entry(entry_id: <id>, content: "Updated without project number parameter")` | `success: true` (falls back to existing project number)|
| Update tags              | `team_update_entry(project_number: 5, entry_id: <id>, tags: ["updated-team"])`          | Tags changed on team entry                           |

| Update entry_type        | `team_update_entry(project_number: 5, entry_id: <id>, entry_type: "technical_note")`    | Entry type changed                                   |
| Update is_archived       | `team_update_entry(project_number: 5, entry_id: <id>, is_archived: true)`               | Entry is archived                                    |
| Update with version      | `team_update_entry(project_number: 5, entry_id: <id>, expected_version: <v>, content: "V2")`| `success: true`, version increments                  |
| Update conflict          | `team_update_entry(project_number: 5, entry_id: <id>, expected_version: <stale_v>, content: "V3")`| Structured error with `VERSION_CONFLICT` code       |
| Update nonexistent       | `team_update_entry(project_number: 5, entry_id: 999999, content: "x")`                  | Structured error: `{ success: false, error: "..." }` |
| Soft delete              | `team_delete_entry(project_number: 5, entry_id: <id>)`                                  | `success: true`, `message` confirming deletion       |
| List deleted entries     | `team_list_deleted_entries(project_number: 5)`                                          | Returns soft-deleted entry in the list               |
| Restore entry            | `team_restore_entry(project_number: 5, entry_id: <id>)`                                 | `success: true`, entry is restored (`is_deleted = 0`)|
| Restore nonexistent      | `team_restore_entry(project_number: 5, entry_id: 999999)`                               | Structured error: `{ success: false, error: "..." }` |
| Delete nonexistent       | `team_delete_entry(project_number: 5, entry_id: 999999)`                                | Structured error: `{ success: false, error: "..." }` |
| Merge tags               | `team_merge_tags(project_number: 5, source_tag: "team-old", target_tag: "team-new")`    | `success: true`, `entriesUpdated`, `sourceDeleted`   |
| Merge same tag           | `team_merge_tags(project_number: 5, source_tag: "team-new", target_tag: "team-new")`    | Structured error: `{ success: false, error: "..." }` |
| Merge nonexistent source | `team_merge_tags(project_number: 5, source_tag: "nonexistent-xyz", target_tag: "x")`    | Structured error: `{ success: false, error: "..." }` |

### 14.8 Team Analytics

| Test             | Command/Action                           | Expected Result                                                     |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Default stats    | `team_get_statistics`                    | `totalEntries`, `entriesByType`, `entriesByPeriod`, `authors` array |
| Group by month   | `team_get_statistics(group_by: "month")` | `entriesByPeriod` periods grouped by month                          |
| Group by day     | `team_get_statistics(group_by: "day")`   | `entriesByPeriod` periods grouped by day                            |
| Author breakdown | Inspect `authors` field                  | Array of `{ author, count }` for each contributor                   |

### 14.9 Team Vector Search

| Test                    | Command/Action                                                                      | Expected Result                                     |
| ----------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Rebuild team index      | `team_rebuild_vector_index`                                                         | `success: true`, `entriesIndexed` > 0               |
| Team vector stats       | `team_get_vector_index_stats`                                                       | `available`, `itemCount`, `modelName`, `dimensions` |
| Team semantic query     | `team_semantic_search(project_number: 5, query: "team standup")`                    | ≥ 1 result with `similarity` score                  |
| Team related by ID      | `team_semantic_search(project_number: 5, entry_id: <team_entry_id>)`                | Semantically similar team entries bypassing strings |
| Team semantic threshold | `team_semantic_search(project_number: 5, query: "test", similarity_threshold: 0.5)` | Fewer results than default threshold (0.25)         |
| Team add to index       | `team_add_to_vector_index(project_number: 5, entry_id: <team_entry_id>)`            | `success: true`, `entryId` in response              |
| Team add nonexistent    | `team_add_to_vector_index(project_number: 5, entry_id: 999999)`                     | `{ success: false, error: "..." }`                  |

### 14.10 Team Cross-Project Insights

| Test                 | Command/Action                                                                      | Expected Result                                                                           |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Default insights     | `team_get_cross_project_insights`                                                   | `project_count ≥ 1`, project 5 with `entry_count ≥ 3`, `top_tags` and `time_distribution` |
| Insights with dates  | `team_get_cross_project_insights(start_date: "2026-01-01", end_date: "2026-03-01")` | Date-filtered — project 5 visible if S15–S17 fall within range                            |
| Insights min_entries | `team_get_cross_project_insights(min_entries: 1)`                                   | Same or more projects than default (`min_entries: 3`)                                     |
| Empty result         | `team_get_cross_project_insights(min_entries: 9999)`                                | `project_count: 0`, `projects: []`, `message` present                                     |

### 14.11 Team Relationships

| Test                  | Command/Action                                                                                                                    | Expected Result                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Link entries          | `team_link_entries(project_number: 5, from_entry_id: <A>, to_entry_id: <B>, relationship_type: "references")`                     | `success: true`, `relationship` object               |
| Link with description | `team_link_entries(project_number: 5, from_entry_id: <A>, to_entry_id: <B>, relationship_type: "implements", description: "...")` | Relationship created with `description`              |
| Duplicate link        | Call `team_link_entries(project_number: 5)` again with same params                                                                | `duplicate: true`, `message`                         |
| Link nonexistent      | `team_link_entries(project_number: 5, from_entry_id: 999999, to_entry_id: <B>, ...)`                                              | Structured error: `{ success: false, error: "..." }` |
| Visualize by entry    | `team_visualize_relationships(project_number: 5, entry_id: <A>)`                                                                  | `mermaid` string, `nodeCount`, `edgeCount`           |
| Visualize by tag      | `team_visualize_relationships(project_number: 5, tag: "team-test")`                                                               | Mermaid diagram scoped to tag                        |
| Visualize nonexistent | `team_visualize_relationships(project_number: 5, entry_id: 999999)`                                                               | Structured error or empty diagram                    |

### 14.12 Team IO & Export

| Test               | Command/Action                                                                      | Expected Result                           |
| ------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| Export JSON        | `team_export_entries(project_number: 5, format: "json", limit: 5)`                  | `format: "json"`, `data` string, `count`  |
| Export markdown    | `team_export_entries(project_number: 5, format: "markdown", limit: 5)`              | `format: "markdown"`, `data` string       |
| IO Export markdown | `team_export_markdown(project_number: 5, output_dir: "tmp_team_md", limit: 5)`      | Generates local `.md` files in target dir |
| IO Import external | `team_import_external(project_number: 5, markdown_content: "...", dry_run: true)` | Parses external wiki format |
| IO Import dry run  | `team_import_markdown(project_number: 5, source_dir: "tmp_team_md", dry_run: true)` | Returns mock counts, resolves `author`    |

### 14.13 Team Backup

| Test              | Command/Action                          | Expected Result                                            |
| ----------------- | --------------------------------------- | ---------------------------------------------------------- |
| Named backup      | `team_backup(name: "team-test-backup")` | `success: true`, `filename`, `path`, `sizeBytes`           |
| Auto-named backup | `team_backup`                           | Backup created with auto-generated timestamped name        |
| List backups      | `team_list_backups`                     | `backups` array with metadata, `total`, `backupsDirectory` |

### 14.14 Team Resources

| Test             | URI                        | Expected Result                                                       |
| ---------------- | -------------------------- | --------------------------------------------------------------------- |
| Recent entries   | `memory://team/recent`     | JSON with `entries` (author-enriched), `count`, `source: "team"`      |
| Statistics       | `memory://team/statistics` | `configured: true`, `totalEntries`, `authors` array, `source: "team"` |
| Author breakdown | `memory://team/statistics` | `authors` contains `{ author: "<name>", count: N }` for each author   |

### 14.15 Insights & Team Collaboration Metrics

| Test                 | Command/Action                                 | Expected Result                                                                |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Matrix structure     | `team_get_collaboration_matrix`                | `authorActivity` and `impactFactor` object arrays present                      |
| Matrix author        | Inspect `team_get_collaboration_matrix` result | Authors like "alice" and "bob" (from S15-S17) exist in metrics                 |
| Digest resource      | Read `memory://insights/digest`                | Either full snapshot JSON or graceful "no digest available" message            |
| Team collab resource | Read `memory://insights/team-collaboration`    | Same payload structure as `team_get_collaboration_matrix` with `success: true` |

### 14.16 Cleanup

| Test        | Command/Action                                                        | Expected Result                 |
| ----------- | --------------------------------------------------------------------- | ------------------------------- |
| Delete test | `team_delete_entry(project_number: 5, entry_id: <team_test_id>)` | Test entries removed (optional) |