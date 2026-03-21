# Test memory-journal-mcp — Schemas, Resources & GitHub

Exhaustively validate the memory-journal-mcp server's output schemas, resource handling, and GitHub integration.

**Scope:** Cross-cutting validation of all 61 tools (60 with outputSchema + Code Mode) and 28 resources — this file covers outputSchema verification, all resource validation (static + template), and GitHub tool happy paths + lifecycle + cleanup. Phases 0-2. Error handling, data integrity, boundary values, and implementation bug detection are covered in `test-tools3.md`.

**Prerequisites:**

- The core tests in `test-tools.md` must have completed successfully and any fixes applied before running this file.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.
- Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Create a plan to implement any fixes and/or improvements/optimizations needed, including changes to `server-instructions.md`/`server-instructions.ts` or this file (`test-server/test-tools2.md`).
2. If the plan requires no user decisions, proceed with implementation immediately. Use `code-map.md` as a source of truth and ensure fixes comply with `C:\Users\chris\Desktop\adamic\skills\mcp-builder`.
3. After implementation: run `npm run lint && npm run typecheck`, fix any issues, run `npx vitest run`, fix broken tests, update `UNRELEASED.md`, and commit without pushing.
4. Re-test fixes with direct MCP calls.
5. Provide a final summary — after re-testing if fixes were needed, or immediately if no issues were found.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Read `memory://briefing` to confirm context loaded (the briefing table confirms receipt).

---

## Phase 0: outputSchema Validation

> [!NOTE]
> **60 tools** now return `structuredContent` validated against Zod output schemas (`mj_execute_code` intentionally excluded — its dynamic return type produces a bare `{}` JSON Schema that crashes clients processing `structuredContent`).
> Verify each response is structured JSON (not raw text).

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

## Phase 1: All Resources

### 1.1 Static Resources

| Resource          | URI                          | Test                                                                                                                                              |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Briefing          | `memory://briefing`          | Returns JSON with `userMessage`, `templateResources`, `journal`, `github`, optional `rulesFile`, `skillsDir`, `workflowSummary`, `copilotReviews` |
| Instructions      | `memory://instructions`      | Full server instructions — verify it references all 61 tools and key resources                                                                    |
| Recent entries    | `memory://recent`            | Read, verify 10 entries with typed fields                                                                                                         |
| Significant       | `memory://significant`       | Verify entries have `importance`, sorted by importance (primary), timestamp (secondary)                                                           |
| Significant order | `memory://significant`       | Compare adjacent entries: `entries[0].importance >= entries[1].importance` etc.                                                                   |
| Tags              | `memory://tags`              | Read, verify tag counts match `list_tags` output                                                                                                  |
| Statistics        | `memory://statistics`        | Read, verify structured stats match `get_statistics` output                                                                                       |
| Health            | `memory://health`            | Shows DB stats, tool filter status, vector index health                                                                                           |
| GitHub status     | `memory://github/status`     | Compact JSON with repo, branch, CI, issues, PRs, Kanban summary (includes milestones)                                                             |
| Repo insights     | `memory://github/insights`   | Compact summary of stars, forks, and 14-day traffic                                                                                               |
| GitHub milestones | `memory://github/milestones` | Open milestones with completion percentages                                                                                                       |
| Graph recent      | `memory://graph/recent`      | Mermaid diagram with harmonized arrows (`-->`, `==>`, `-.->`, `--x`, `<-->`)                                                                      |
| Graph actions     | `memory://graph/actions`     | CI/CD narrative graph (verify graceful output when no workflow entries exist)                                                                     |
| Actions recent    | `memory://actions/recent`    | Recent workflow runs (verify graceful output when no workflow entries exist)                                                                      |
| Team recent       | `memory://team/recent`       | Author-enriched entries, `source: "team"`, `count`                                                                                                |
| Team statistics   | `memory://team/statistics`   | `configured: true`, `authors` array with `{ author, count }`, `source: "team"`                                                                    |
| Help index        | `memory://help`              | Lists all tool groups with counts, descriptions, and `totalTools`                                                                                 |
| Help group detail | `memory://help/{group}`      | Per-group tool listing with parameters, descriptions, and annotations (test with `memory://help/core`)                                            |
| Help gotchas      | `memory://help/gotchas`      | Field notes and practical tips (moved from server instructions); verify non-empty content with actionable guidance                                |
| Rules             | `memory://rules`             | Rules file content (requires `RULES_FILE_PATH`); graceful empty if not set                                                                        |
| Workflows         | `memory://workflows`         | Workflow summary (requires `MEMORY_JOURNAL_WORKFLOW_SUMMARY` or `--workflow-summary`); returns `{ configured: false }` when not set               |
| Skills            | `memory://skills`            | Indexed skills listing (requires `SKILLS_DIR_PATH`); graceful empty if not set                                                                    |

### 1.2 Template Resources — Happy Path

> [!CAUTION]
> Issue and PR template URIs require the `/entries` or `/timeline` suffix — they are **NOT** bare `memory://issues/{number}` or `memory://prs/{number}`. Using bare URIs will return "Resource not found". Always use the full paths shown in the table below (e.g. `memory://issues/55/entries`, `memory://prs/67/timeline`).

| Template         | Test URI                       | Expected Result                                                                                                                     |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Project timeline | `memory://projects/5/timeline` | Timeline data                                                                                                                       |
| Issue entries    | `memory://issues/55/entries`   | Entries linked to issue #55                                                                                                         |
| PR entries       | `memory://prs/67/entries`      | Entries linked to PR #67 (permanent test fixture)                                                                                   |
| PR timeline      | `memory://prs/67/timeline`     | PR lifecycle with `prMetadata` (live state) and `timelineNote`                                                                      |
| Kanban JSON      | `memory://kanban/5`            | Board JSON                                                                                                                          |
| Kanban diagram   | `memory://kanban/5/diagram`    | Raw Mermaid text (`text/plain` MIME), not JSON-wrapped                                                                              |
| Milestone detail | `memory://milestones/<N>`      | Milestone with completion %, `openIssues` + `closedIssues` counts, and hint to use `get_github_issues` for individual issue details |

### 1.3 Template Resources — Error Paths

| Template                   | Test URI                           | Expected Result                                                 |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Nonexistent project        | `memory://projects/99999/timeline` | Empty or graceful response (no entries for nonexistent project) |
| Nonexistent issue          | `memory://issues/999999/entries`   | Empty entries array (no crash)                                  |
| Nonexistent PR             | `memory://prs/999999/entries`      | Empty entries array (no crash)                                  |
| Nonexistent PR timeline    | `memory://prs/999999/timeline`     | Graceful response with empty/null `prMetadata`                  |
| Nonexistent Kanban         | `memory://kanban/99999`            | Error or empty board (no crash)                                 |
| Nonexistent Kanban diagram | `memory://kanban/99999/diagram`    | Error or empty diagram (no crash)                               |
| Nonexistent milestone      | `memory://milestones/999999`       | Error or empty milestone data (no crash)                        |

---

## Phase 2: GitHub Integration (16 tools)

### 2.1 Read-Only Tools

| Test                  | Command/Action                                 | Expected Result                                          |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Context               | `get_github_context`                           | Returns repo, branch, issues, PRs                        |
| List issues           | `get_github_issues(limit: 5)`                  | Returns open issues                                      |
| Issue milestone data  | Inspect issue objects                          | Issues include `milestone` field (if assigned)           |
| Get issue             | `get_github_issue(issue_number: <N>)`          | Returns issue details                                    |
| List PRs              | `get_github_prs(limit: 5)`                     | Returns open PRs                                         |
| List closed issues    | `get_github_issues(state: "closed", limit: 3)` | Returns closed issues                                    |
| List all issues       | `get_github_issues(state: "all", limit: 3)`    | Returns both open and closed issues                      |
| List closed PRs       | `get_github_prs(state: "closed", limit: 3)`    | Returns closed/merged PRs                                |
| List all PRs          | `get_github_prs(state: "all", limit: 3)`       | Returns both open and closed PRs                         |
| Get PR                | `get_github_pr(pr_number: <N>)`                | Returns PR details (use known closed PR)                 |
| Get nonexistent issue | `get_github_issue(issue_number: 999999)`       | Structured error: `{ error: "Issue #999999 not found" }` |
| Get nonexistent PR    | `get_github_pr(pr_number: 999999)`             | Structured error: `{ error: "PR #999999 not found" }`    |

### 2.2 Issue Lifecycle Tools

> [!CAUTION]
> These tools **create and close real GitHub issues**. Use with awareness.

| Test                          | Command/Action                                                                                                                                                                                       | Expected Result                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create issue + entry          | `create_github_issue_with_entry(title: "Test: Unreleased Verification", project_number: 5)`                                                                                                          | GitHub issue created + journal entry created + added to project                                                                                                                                                                                               |
| Create with milestone         | `create_github_issue_with_entry(title: "Test: Milestone", milestone_number: <N>)`                                                                                                                    | Issue assigned to milestone, verify on GitHub                                                                                                                                                                                                                 |
| Close issue + entry           | `close_github_issue_with_entry(issue_number: <new_issue>, resolution_notes: "Verified working")`                                                                                                     | Issue closed + resolution entry created                                                                                                                                                                                                                       |
| Close with move_to_done       | `close_github_issue_with_entry(issue_number: <new_issue>, move_to_done: true, project_number: 5)`                                                                                                    | Issue closed + `kanban` block in response. `kanban.moved: true` expected — uses idempotent `addProjectItem` to resolve item ID directly (no board-scan race condition)                                                                                        |
| Create with full params       | `create_github_issue_with_entry(title: "Test: Full", body: "Description", labels: ["test"], project_number: 5, initial_status: "In Progress", entry_content: "Custom journal text", tags: ["test"])` | Issue created with body/labels, project item in "In Progress", journal entry uses custom content                                                                                                                                                              |
| Close with comment            | `close_github_issue_with_entry(issue_number: <new_issue>, resolution_notes: "Done", comment: "Closing comment", tags: ["resolved"])`                                                                 | Issue closed with comment posted, entry tagged                                                                                                                                                                                                                |
| Close already closed          | `close_github_issue_with_entry(issue_number: <known_closed>)`                                                                                                                                        | Structured error: `{ success: false, error: "Issue #X is already closed" }`                                                                                                                                                                                   |
| Close move_to_done no project | `close_github_issue_with_entry(issue_number: <open_issue>, move_to_done: true)`                                                                                                                      | When `DEFAULT_PROJECT_NUMBER` is configured: uses default project, issue closes (`success: true`), Kanban move attempted against default project. When NOT configured: `kanban: { moved: false, error: "project_number required when move_to_done is true" }` |

### 2.3 Kanban Tools

| Test                | Command/Action                                                                     | Expected Result                                                       |
| ------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Get board           | `get_kanban_board(project_number: 5)`                                              | Returns board structure with columns/items                            |
| Kanban resource     | Read `memory://kanban/5`                                                           | JSON board data                                                       |
| Kanban diagram      | Read `memory://kanban/5/diagram`                                                   | Raw Mermaid text (`text/plain` MIME), not JSON-wrapped                |
| Move item           | `move_kanban_item(project_number: 5, item_id: <id>, target_status: "In Progress")` | Item status updated                                                   |
| Move invalid status | `move_kanban_item(project_number: 5, item_id: <id>, target_status: "Nonexistent")` | Structured error with `availableStatuses` array listing valid options |
| Board nonexistent   | `get_kanban_board(project_number: 99999)`                                          | Structured error: `{ error: "Project #99999 not found..." }`          |

### 2.4 Milestone Tools

> [!CAUTION]
> These tools **create, modify, and delete real GitHub milestones**. Clean up test milestones after testing.

| Test                 | Command/Action                                                                                   | Expected Result                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| List milestones      | `get_github_milestones(state: "open")`                                                           | Returns milestones array with `completion_percentage`, `open_issues`                                              |
| List all states      | `get_github_milestones(state: "all")`                                                            | Returns both open and closed milestones                                                                           |
| Get milestone detail | `get_github_milestone(milestone_number: <N>)`                                                    | Returns single milestone with full metadata                                                                       |
| Create milestone     | `create_github_milestone(title: "Test Milestone", description: "Testing", due_on: "YYYY-MM-DD")` | Returns `success: true`, created milestone with number and URL (⚠️ `due_on` must be `YYYY-MM-DD`, not ISO 8601)   |
| Update milestone     | `update_github_milestone(milestone_number: <new>, description: "Updated description")`           | Returns `success: true`, updated milestone                                                                        |
| Close milestone      | `update_github_milestone(milestone_number: <new>, state: "closed")`                              | Milestone state changed to `closed`                                                                               |
| Delete milestone     | `delete_github_milestone(milestone_number: <new>, confirm: true)`                                | Returns `success: true`, milestone removed from GitHub                                                            |
| Get nonexistent      | `get_github_milestone(milestone_number: 999999)`                                                 | Structured error: `{ error: "Milestone #999999 not found" }`                                                      |
| Milestone resource   | Read `memory://github/milestones`                                                                | Static resource lists open milestones with completion %                                                           |
| Milestone detail     | Read `memory://milestones/<N>`                                                                   | Template resource shows milestone with completion %, openIssues + closedIssues counts, and hint for issue details |

### 2.5 Repository Insights Tool

| Test              | Command/Action                             | Expected Result                                    |
| ----------------- | ------------------------------------------ | -------------------------------------------------- |
| Default (stars)   | `get_repo_insights`                        | Returns `stars`, `forks`, `watchers`, `openIssues` |
| Traffic section   | `get_repo_insights(sections: "traffic")`   | Returns 14-day `clones` and `views` aggregates     |
| Referrers section | `get_repo_insights(sections: "referrers")` | Returns top 5 referral sources                     |
| Paths section     | `get_repo_insights(sections: "paths")`     | Returns top 5 popular content paths                |
| All sections      | `get_repo_insights(sections: "all")`       | Returns full payload with all sections above       |

### 2.6 Copilot Review Tool

| Test                  | Command/Action                                        | Expected Result                                                               |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Reviewed PR           | `get_copilot_reviews(pr_number: <known_reviewed_pr>)` | Returns `state`, `commentCount`, `comments` array with `path`, `line`, `body` |
| Unreviewed PR         | `get_copilot_reviews(pr_number: <unreviewed_pr>)`     | Returns `state: "none"`, `commentCount: 0`, empty `comments`                  |
| Auto-detect repo      | `get_copilot_reviews(pr_number: 1)`                   | Uses auto-detected owner/repo from git                                        |
| No GitHub integration | (server without `GITHUB_TOKEN`)                       | Returns `{ success: false, error: "GitHub integration not available" }`       |

### 2.7 GitHub Test Cleanup

> [!IMPORTANT]
> After GitHub testing, ensure all test artifacts are removed. Use the checklist below.

| Cleanup Step           | Command/Action                                                    |
| ---------------------- | ----------------------------------------------------------------- |
| Close test issues      | `close_github_issue_with_entry` for any unclosed test issues      |
| Delete test milestones | `delete_github_milestone` for any test milestones still on GitHub |
| Verify project board   | `get_kanban_board(project_number: 5)` — no orphaned test items    |

---

## Test Execution Order

0. **Phase 0**: outputSchema Validation (verify structured responses across all 61 tools)
1. **Phase 1**: All Resources (static + template, happy path + error paths)
2. **Phase 2**: GitHub Integration (happy paths, lifecycle, milestones, insights, copilot, cleanup)

> [!NOTE]
> Continue with `test-tools3.md` for Phases 3-7 (prompts, error paths, data integrity, boundary values, bug detection).

---

## Success Criteria

### outputSchema Validation (Phase 0)

- [ ] All 60 outputSchema tools return `structuredContent` (not raw text) — `mj_execute_code` excluded by design

### Resources (Phase 1)

- [ ] All 20 static resources return valid data
- [ ] All 8 template resources work with valid parameters
- [ ] All 8 template resources handle invalid/nonexistent IDs gracefully (no crashes)
- [ ] `memory://significant` includes `importance` field and is sorted by importance (primary) then timestamp (secondary)
- [ ] `memory://tags` tag counts match `list_tags` output
- [ ] `memory://statistics` structured stats match `get_statistics` output
- [ ] `memory://github/insights` returns compact stats including traffic aggregates
- [ ] `memory://graph/recent` uses harmonized arrows (`-->`, `==>`, `-.->`, `--x`, `<-->`)
- [ ] `memory://instructions` references all 61 tools and key resources

### GitHub Integration (Phase 2)

- [ ] GitHub issue lifecycle tools create/close issues correctly
- [ ] `create_github_issue_with_entry` with `body`, `labels`, `initial_status`, `entry_content` works
- [ ] `create_github_issue_with_entry` with `milestone_number` assigns issue to milestone
- [ ] `close_github_issue_with_entry` returns structured error for already-closed issues
- [ ] `close_github_issue_with_entry` with `move_to_done: true` behavior correct with/without `DEFAULT_PROJECT_NUMBER`
- [ ] `get_github_issues` and `get_github_prs` with `state: "closed"` and `state: "all"` work
- [ ] Milestone CRUD lifecycle works end-to-end (create → update → close → delete)
- [ ] `memory://milestones/{number}` returns milestone with completion %, issue counts, and hint
- [ ] `get_repo_insights` returns correct data based on `sections` parameter
- [ ] `get_copilot_reviews` returns review data for reviewed PRs and `state: "none"` for unreviewed
- [ ] All GitHub test artifacts cleaned up after testing
