# Test memory-journal-mcp — Output Schemas

**Scope:** Verify all 60 outputSchema tools return `structuredContent` (not raw text). `mj_execute_code` intentionally excluded — its dynamic return type produces a bare `{}` JSON Schema that crashes clients processing `structuredContent`.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. Re-test fixes with direct MCP calls.
4. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 0: outputSchema Validation

### 0.1 Original 5 Tools

| Tool                   | Verification                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_recent_entries`   | Response has `entries` array with typed objects                                                                                                |
| `search_entries`       | Response has `entries` array with `id`, `timestamp`, `content`, etc.                                                                           |
| `search_by_date_range` | Response has `entries` array                                                                                                                   |
| `get_entry_by_id`      | Response has `entry` object with `relationships` array                                                                                         |
| `get_statistics`       | Response has `totalEntries`, `entriesByType`, `entriesByPeriod`, `decisionDensity`, `relationshipComplexity`, `activityTrend`, `causalMetrics` |

### 0.2 Core Read Tools

| Tool                         | Schema                             | Verification                                                   |
| ---------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `semantic_search`            | `SemanticSearchOutputSchema`       | `query`, `entries` (with `similarity`), `count`                |
| `list_tags`                  | `TagsListOutputSchema`             | `tags` array with `name`, `count` per tag                      |
| `get_vector_index_stats`     | `VectorStatsOutputSchema`          | `available`, `itemCount`, `modelName`, `dimensions`, `success` |
| `visualize_relationships`    | `VisualizationOutputSchema`        | `entry_count`, `relationship_count`, `mermaid`, `legend`       |
| `get_cross_project_insights` | `CrossProjectInsightsOutputSchema` | `project_count`, `total_entries`, `projects` array             |

### 0.3 Mutation Tools

| Tool                   | Schema                    | Verification                                                            |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `create_entry`         | `CreateEntryOutputSchema` | `success: true`, `entry` object                                         |
| `create_entry_minimal` | `CreateEntryOutputSchema` | `success: true`, `entry` object                                         |
| `update_entry`         | `UpdateEntryOutputSchema` | `success`, `entry` (or `error`)                                         |
| `delete_entry`         | `DeleteEntryOutputSchema` | `success`, `entryId`, `permanent`                                       |
| `link_entries`         | `LinkEntriesOutputSchema` | `success: true`, `relationship` object, optional `duplicate`, `message` |
| `merge_tags`           | `MergeTagsOutputSchema`   | `success`, `sourceTag`, `targetTag`, `entriesUpdated`, `message`        |

### 0.4 GitHub Tools

| Tool                  | Schema                          | Verification                                                   |
| --------------------- | ------------------------------- | -------------------------------------------------------------- |
| `get_github_issues`   | `GitHubIssuesListOutputSchema`  | `owner`, `repo`, `issues` array, `count`                       |
| `get_github_issues`   | (milestone field)               | Issue objects include optional `milestone` with number & title |
| `get_github_prs`      | `GitHubPRsListOutputSchema`     | `owner`, `repo`, `pullRequests` array, `count`                 |
| `get_github_issue`    | `GitHubIssueResultOutputSchema` | `issue` object with `body`, `labels`, `assignees`              |
| `get_github_pr`       | `GitHubPRResultOutputSchema`    | `pullRequest` with `draft`, `headBranch`, `additions`          |
| `get_github_context`  | `GitHubContextOutputSchema`     | `repoName`, `branch`, `issues`, `pullRequests`                 |
| `get_kanban_board`    | `KanbanBoardOutputSchema`       | `projectId`, `columns` array, `statusOptions`                  |
| `get_repo_insights`   | `RepoInsightsOutputSchema`      | `owner`, `repo`, requested `section` data                      |
| `get_copilot_reviews` | `CopilotReviewsOutputSchema`    | `prNumber`, `state`, `commentCount`, `comments` array          |

### 0.5 Backup Tools

| Tool              | Schema                       | Verification                                                                                   |
| ----------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `backup_journal`  | `BackupResultOutputSchema`   | `success`, `message`, `filename`, `path`, `sizeBytes`                                          |
| `list_backups`    | `BackupsListOutputSchema`    | `backups` array, `total`, `backupsDirectory`                                                   |
| `cleanup_backups` | `CleanupBackupsOutputSchema` | `success`, `deleted` array, `deletedCount`, `keptCount`                                        |
| `restore_backup`  | `RestoreResultOutputSchema`  | `success`, `message`, `restoredFrom`, `previousEntryCount`, `newEntryCount`, `revertedChanges` |

### 0.6 Remaining Tools

| Tool                             | Schema                                   | Verification                                                 |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `test_simple`                    | `TestSimpleOutputSchema`                 | `message` string                                             |
| `export_entries`                 | `ExportEntriesOutputSchema`              | `format`, `entries` (JSON) or `content` (markdown)           |
| `rebuild_vector_index`           | `RebuildVectorIndexOutputSchema`         | `success`, `entriesIndexed`, optional `failedEntries`        |
| `add_to_vector_index`            | `AddToVectorIndexOutputSchema`           | `success`, `entryId`                                         |
| `move_kanban_item`               | `MoveKanbanItemOutputSchema`             | `success`, `itemId`, `newStatus`, `projectNumber`, `message` |
| `create_github_issue_with_entry` | `CreateGitHubIssueWithEntryOutputSchema` | `success`, `issue`, `journalEntry`, optional `project`       |
| `close_github_issue_with_entry`  | `CloseGitHubIssueWithEntryOutputSchema`  | `success`, `issue`, `journalEntry`, optional `kanban`        |

### 0.7 Milestone Tools

| Tool                      | Schema                              | Verification                                                     |
| ------------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `get_github_milestones`   | `GitHubMilestonesListOutputSchema`  | `milestones` array with `completion_percentage`, `total`         |
| `get_github_milestone`    | `GitHubMilestoneResultOutputSchema` | `milestone` object with number, title, state, open/closed counts |
| `create_github_milestone` | `CreateMilestoneOutputSchema`       | `success`, `milestone` (number, title, url), `message`           |
| `update_github_milestone` | `UpdateMilestoneOutputSchema`       | `success`, `milestone` (updated fields), `message`               |
| `delete_github_milestone` | `DeleteMilestoneOutputSchema`       | `success`, `message`                                             |

### 0.8 Team Tools

| Tool                              | Schema                                 | Verification                                                               |
| --------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `team_create_entry`               | `TeamCreateOutputSchema`               | `success`, `entry` (with `author`), `author` field                         |
| `team_get_recent`                 | `TeamEntriesListOutputSchema`          | `entries` array (each with `author`), `count`                              |
| `team_search`                     | `TeamEntriesListOutputSchema`          | `entries` array (each with `author`), `count`                              |
| `team_get_entry_by_id`            | `TeamEntryDetailOutputSchema`          | `success`, `entry` (with `author`), optional `relationships`, `importance` |
| `team_list_tags`                  | `TeamTagsListOutputSchema`             | `tags` array with `name`, `count`                                          |
| `team_search_by_date_range`       | `TeamEntriesListOutputSchema`          | `entries` array (each with `author`), `count`                              |
| `team_update_entry`               | `TeamUpdateOutputSchema`               | `success`, `entry` (updated)                                               |
| `team_delete_entry`               | `TeamDeleteOutputSchema`               | `success`, `message`                                                       |
| `team_merge_tags`                 | `TeamMergeTagsOutputSchema`            | `success`, `message`, `entriesUpdated`, `sourceDeleted`                    |
| `team_get_statistics`             | `TeamStatisticsOutputSchema`           | `totalEntries`, `entryTypes`, `topTags`, `authors`                         |
| `team_link_entries`               | `TeamLinkEntriesOutputSchema`          | `success`, `relationship`, optional `alreadyExists`                        |
| `team_visualize_relationships`    | `TeamVisualizeOutputSchema`            | `mermaid`, `nodeCount`, `edgeCount`                                        |
| `team_export_entries`             | `TeamExportOutputSchema`               | `format`, `data`, `count`                                                  |
| `team_backup`                     | `TeamBackupOutputSchema`               | `success`, `filename`, `path`, `sizeBytes`                                 |
| `team_list_backups`               | `TeamBackupsListOutputSchema`          | `backups` array, `total`, `backupsDirectory`                               |
| `team_semantic_search`            | `TeamSemanticSearchOutputSchema`       | `query`, `entries` (with `similarity`), `count`                            |
| `team_get_vector_index_stats`     | `TeamVectorStatsOutputSchema`          | `available`, `itemCount`, `modelName`, `dimensions`, `success`             |
| `team_rebuild_vector_index`       | `TeamRebuildVectorIndexOutputSchema`   | `success`, `entriesIndexed`, optional `failedEntries`                      |
| `team_add_to_vector_index`        | `TeamAddToVectorIndexOutputSchema`     | `success`, `entryId`                                                       |
| `team_get_cross_project_insights` | `TeamCrossProjectInsightsOutputSchema` | `project_count`, `total_entries`, `projects`                               |

---

## Success Criteria

- [ ] All 60 outputSchema tools return `structuredContent` (not raw text) — `mj_execute_code` excluded by design
