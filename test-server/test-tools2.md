# Test memory-journal-mcp — Validation, GitHub & Edge Cases

Exhaustively validate the memory-journal-mcp server's output schemas, error handling, GitHub integration, template/static resources, prompt handlers, data integrity, boundary values, and implementation correctness.

**Scope:** Cross-cutting validation of all 61 tools (60 with outputSchema + Code Mode) and 28 resources — this file covers outputSchema verification, all resource validation, GitHub tool happy paths + lifecycle + cleanup, prompt handler verification, structured error testing, data integrity round-trips, boundary values, and implementation bug detection. Phases 0-7.

**Prerequisites:**

- The core tests in `test-tools.md` must have completed successfully and any fixes applied before running this file.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.
- Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Create a plan to fix any issues found, including changes to `server-instructions.md`/`server-instructions.ts` or this file (`test-server/test-tools2.md`).
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
| Help gotchas      | `memory://help/gotchas`      | Field notes and practical tips (moved from server instructions); verify non-empty content with actionable guidance                                 |
| Rules             | `memory://rules`             | Rules file content (requires `RULES_FILE_PATH`); graceful empty if not set                                                                        |
| Workflows         | `memory://workflows`         | Workflow summary (requires `MEMORY_JOURNAL_WORKFLOW_SUMMARY` or `--workflow-summary`); returns `{ configured: false }` when not set                |
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

## Phase 3: Prompt Handler Verification (16 prompts) [DO NOT SKIP!]

> [!IMPORTANT]
> Prompts return `GetPromptResult` objects with `messages` arrays. Most MCP clients don't expose `prompts/get` as a callable tool — run the script below instead. It handles session init, prompt listing, and shape verification automatically. See `test-server/README.md` for full details.

```powershell
npm run build
node test-server/test-prompts.mjs
```

| Check                   | Expected                                                       |
| ----------------------- | -------------------------------------------------------------- |
| Prompts listed          | 16 prompts with correct argument signatures                    |
| All 18 prompt calls     | PASS — `messages[0].role === 'user'`, non-empty `content.text` |
| Nonexistent prompt      | MCP error (code `-32602`)                                      |
| Missing required arg    | Error returned or handled gracefully                           |
| **Total**               | **20 pass, 0 fail**                                            |

The tables below document what the script tests — use them as a reference for manual verification or when adding new prompts.

### 3.1 Workflow Prompts (10 prompts)

#### No-Argument Prompts

| Prompt               | Arguments | Expected Response                                                                                               |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `prepare-standup`    | _(none)_  | `messages` array with 1 `user` role message containing "standup" and date references                            |
| `weekly-digest`      | _(none)_  | `messages` array with 1 `user` role message containing "weekly digest"                                          |
| `goal-tracker`       | _(none)_  | `messages` array with 1 `user` role message containing "goals" and "milestones"                                 |
| `get-context-bundle` | _(none)_  | `messages` array with 1 `user` role message containing "Project context bundle", recent entries, and statistics |
| `confirm-briefing`   | _(none)_  | `messages` array with 1 `user` role message containing "Session Context Received" and entry count               |
| `session-summary`    | _(none)_  | `messages` array with 1 `user` role message containing "session summary" and instructions for entry creation    |

#### Required-Argument Prompts

| Prompt           | Arguments                                            | Expected Response                                                                                             |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `find-related`   | `query: "architecture"`                              | `messages` array with 1 `user` role message containing `"architecture"` and matching entries (from seed data) |
| `analyze-period` | `start_date: "2026-01-01"`, `end_date: "2026-12-31"` | `messages` array with 1 `user` role message containing date range and statistics JSON                         |

#### Optional-Argument Prompts

| Prompt               | Arguments                      | Expected Response                                                                                         |
| -------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `prepare-retro`      | _(none — defaults to 14 days)_ | `messages` array with 1 `user` role message containing "retrospective" and "14 days"                      |
| `prepare-retro`      | `days: "7"`                    | `messages` array with 1 `user` role message containing "7 days"                                           |
| `get-recent-entries` | _(none — defaults to 10)_      | `messages` array with 1 `user` role message containing entries formatted with timestamps, types, and tags |
| `get-recent-entries` | `limit: "3"`                   | `messages` array with 1 `user` role message containing at most 3 entries                                  |

### 3.2 GitHub Prompts (6 prompts)

#### Required-Argument Prompts

| Prompt                      | Arguments             | Expected Response                                                                                                |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `project-status-summary`    | `project_number: "5"` | `messages` array with 1 `user` role message containing `"Project #5"` and status summary instructions            |
| `pr-summary`                | `pr_number: "67"`     | `messages` array with 1 `user` role message containing `"PR #67"` and journal entries for that PR (from seed S8) |
| `code-review-prep`          | `pr_number: "67"`     | `messages` array with 1 `user` role message containing `"PR #67"` and review checklist instructions              |
| `pr-retrospective`          | `pr_number: "67"`     | `messages` array with 1 `user` role message containing `"PR #67"` and retrospective instructions                 |
| `project-milestone-tracker` | `project_number: "5"` | `messages` array with 1 `user` role message containing `"Project #5"` and milestone entries (from seed S7)       |

#### No-Argument Prompts

| Prompt                   | Arguments | Expected Response                                                                                           |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------- |
| `actions-failure-digest` | _(none)_  | `messages` array with 1 `user` role message containing "CI/CD failures" and workflow entries (from seed S9) |

### 3.3 Error Handling

| Test                  | Action                                                | Expected Result                                                                         |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Missing required arg  | `prompts/get` for `find-related` with no `query`      | Structured error or empty query handled gracefully (handler uses `args['query'] ?? ''`) |
| Missing required arg  | `prompts/get` for `analyze-period` with no dates      | Structured error or empty dates handled gracefully                                      |
| Nonexistent prompt    | `prompts/get` for `nonexistent-prompt`                | MCP error: prompt not found                                                             |
| Invalid argument name | `prompts/get` for `prepare-standup` with `foo: "bar"` | Succeeds (no-argument prompt ignores extra args)                                        |

### 3.4 Response Shape Verification

For **every** prompt response, verify:

| Check                  | Expected                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| `messages` is an array | `Array.isArray(result.messages) === true`                              |
| At least 1 message     | `messages.length >= 1`                                                 |
| Message has `role`     | `messages[0].role === 'user'`                                          |
| Message has `content`  | `messages[0].content` is object with `type: 'text'` and `text: string` |
| Text is non-empty      | `messages[0].content.text.length > 0`                                  |

---

## Phase 4: Structured Error Response Verification

> [!IMPORTANT]
> All 61 tools now use deterministic error handling via `formatHandlerError()` in `src/utils/error-helpers.ts`. Each handler is wrapped in a `try/catch` block that catches all errors (including Zod validation) and returns enriched structured responses. This phase verifies that no tool produces raw MCP error frames.

### Structured Error Response Pattern

All tools return errors as structured objects via `formatHandlerError()` (never thrown). A thrown error propagates as a raw MCP error, which is unhelpful to clients. The expected pattern:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "VALIDATION_ERROR",
  "category": "validation",
  "recoverable": false,
  "suggestion": "Check input parameters against the tool schema"
}
```

#### Handler Error vs MCP Error — How to Distinguish

There are two kinds of error responses. Only one is correct:

| Type                 | Source                                                     | What you see                                                                                                          | Verdict            |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Handler error** ✅ | Handler catches error and returns enriched `ErrorResponse` | Parseable JSON object with `success`, `error`, `code`, `category`, `recoverable` fields                               | Correct            |
| **MCP error** ❌     | Uncaught throw propagates to MCP framework                 | Raw text error string, often prefixed with `Error:`, wrapped in an `isError: true` content block — no `success` field | Bug — report as ❌ |

**Concrete examples:**

```
✅ Handler error (correct):
{"success": false, "error": "Entry 999999 not found"}

❌ MCP error (bug — handler threw instead of catching):
content: [{type: "text", text: "Error: Entry 999999 not found"}]
isError: true
```

The MCP error case means the handler is missing a `try/catch` block. When testing, if you see a raw error string (especially one without a `success` field), report it as ❌.

#### Zod Validation Errors

Calling a tool with wrong parameter types or missing required fields triggers a Zod validation error. If the handler has no outer `try/catch`, this surfaces as a raw MCP error (often `-32602`). Test every tool with `{}` (empty params) if it has required parameters — the response must be a handler error, not an MCP error.

### Error Path Testing Checklist

For each tool group, verify at least one scenario from each applicable row:

| Error Scenario                      | Tool Groups to Test                                                     | Example Input                                                           |
| ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Nonexistent entry ID                | core, admin, relationships                                              | `entry_id: 999999`                                                      |
| Invalid entry_type enum             | core (`create_entry`, `update_entry`)                                   | `entry_type: "invalid_type"`                                            |
| Invalid significance_type enum      | core (`create_entry`)                                                   | `significance_type: "invalid"`                                          |
| Invalid date format                 | search (`search_by_date_range`)                                         | `start_date: "Jan 1"`                                                   |
| Inverted date range                 | search (`search_by_date_range`)                                         | `start_date: "2026-12-31", end_date: "2026-01-01"` — verify behavior    |
| Vector manager unavailable          | search (`semantic_search`)                                              | Verify `{ success: false, error: "..." }` not raw throw                 |
| Add nonexistent to vector index     | admin (`add_to_vector_index`)                                           | `entry_id: 999999`                                                      |
| Nonexistent backup filename         | backup (`restore_backup`)                                               | `filename: "nonexistent.db"`                                            |
| Path traversal in backup name       | backup (`backup_journal`)                                               | `name: "../../etc/passwd"`                                              |
| Invalid relationship_type enum      | relationships (`link_entries`)                                          | `relationship_type: "invalid"`                                          |
| Missing required params (Zod)       | **Every tool with required params**                                     | `{}` (empty object — must return handler error, not MCP `-32602` error) |
| Wrong param type (Zod)              | **Tools with typed params**                                             | Pass string where number expected, etc.                                 |
| No GitHub token / unavailable       | github (all 16 tools)                                                   | Verify structured `{ error, requiresUserInput }` not raw throw          |
| Nonexistent GitHub issue            | github (`get_github_issue`)                                             | `issue_number: 999999` → `{ error: "Issue #999999 not found" }`         |
| Nonexistent GitHub PR               | github (`get_github_pr`)                                                | `pr_number: 999999` → `{ error: "PR #999999 not found" }`               |
| Nonexistent GitHub milestone        | github (`get_github_milestone`)                                         | `milestone_number: 999999` → `{ error: "Milestone #999999 not found" }` |
| Close already-closed issue          | github (`close_github_issue_with_entry`)                                | Close an issue that's already closed                                    |
| move_to_done without project_number | github (`close_github_issue_with_entry`)                                | `move_to_done: true` but no `project_number`                            |
| Invalid Kanban target_status        | github (`move_kanban_item`)                                             | `target_status: "Nonexistent"` — ⚠️ verify outputSchema compatibility   |
| Nonexistent Kanban project          | github (`get_kanban_board`)                                             | `project_number: 99999`                                                 |
| Merge same tag (source = target)    | admin (`merge_tags`)                                                    | `source_tag: "x", target_tag: "x"`                                      |
| Merge nonexistent source tag        | admin (`merge_tags`)                                                    | `source_tag: "nonexistent-xyz", target_tag: "test"`                     |
| Team DB not configured              | team (all 20 tools)                                                     | Returns `{ success: false, error: "Team database not configured..." }`  |
| Invalid team entry_type             | team (`team_create_entry`)                                              | `entry_type: "invalid"` → structured error                              |
| Nonexistent team entry ID           | team (`team_get_entry_by_id`, `team_update_entry`, `team_delete_entry`) | `entry_id: 999999` → structured error                                   |
| Invalid team date format            | team (`team_search_by_date_range`)                                      | `start_date: "Jan 1"` → structured error                                |
| Merge same team tag                 | team (`team_merge_tags`)                                                | `source_tag: "x", target_tag: "x"` → structured error                   |
| Team link nonexistent               | team (`team_link_entries`)                                              | `from_entry_id: 999999` → structured error                              |
| Team vector unavailable             | team (`team_semantic_search`)                                           | Verify `{ success: false, error: "..." }` not raw throw                 |
| Team add nonexistent to vector      | team (`team_add_to_vector_index`)                                       | `entry_id: 999999` → structured error                                   |
| Team insights empty                 | team (`team_get_cross_project_insights`)                                | Returns all required schema fields even when empty                      |

### What to Report

- ❌ **Fail**: Tool returns a raw MCP error (no JSON body with `success` field) instead of `{ success: false, error: "..." }`
- ⚠️ **Issue**: Tool silently succeeds for invalid input (e.g., `update_entry` returns `success: true` for nonexistent entry)
- ✅ **Pass**: Tool returns `{ success: false, error: "..." }` — correct structured error

### Wrong-Type Numeric Parameter Coercion

For every tool with optional numeric parameters, call the tool with `param: "abc"` (string instead of number). The tool must NOT return a raw MCP `-32602` error. Acceptable behaviors:

- Handler returns `{success: false, error: "..."}` with a validation message
- Handler silently applies the default value
- Handler coerces to NaN and returns a descriptive error

Unacceptable: Raw MCP error frame with `-32602` code.

| Tool                              | Parameter              | Test Call                                                                                     |
| --------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `get_recent_entries`              | `limit`                | `get_recent_entries({limit: "abc"})`                                                          |
| `search_entries`                  | `limit`                | `search_entries({query: "test", limit: "abc"})`                                               |
| `search_by_date_range`            | `limit`                | `search_by_date_range({start_date: "2026-01-01", end_date: "2026-12-31", limit: "abc"})`      |
| `semantic_search`                 | `limit`                | `semantic_search({query: "test", limit: "abc"})`                                              |
| `semantic_search`                 | `similarity_threshold` | `semantic_search({query: "test", similarity_threshold: "abc"})`                               |
| `export_entries`                  | `limit`                | `export_entries({format: "json", limit: "abc"})`                                              |
| `cleanup_backups`                 | `keep_count`           | `cleanup_backups({keep_count: "abc"})`                                                        |
| `visualize_relationships`         | `depth`                | `visualize_relationships({entry_id: 1, depth: "abc"})`                                        |
| `visualize_relationships`         | `limit`                | `visualize_relationships({entry_id: 1, limit: "abc"})`                                        |
| `get_github_issues`               | `limit`                | `get_github_issues({limit: "abc"})`                                                           |
| `get_github_prs`                  | `limit`                | `get_github_prs({limit: "abc"})`                                                              |
| `team_get_recent`                 | `limit`                | `team_get_recent({limit: "abc"})`                                                             |
| `team_search_by_date_range`       | `limit`                | `team_search_by_date_range({start_date: "2026-01-01", end_date: "2026-12-31", limit: "abc"})` |
| `team_export_entries`             | `limit`                | `team_export_entries({format: "json", limit: "abc"})`                                         |
| `team_visualize_relationships`    | `depth`                | `team_visualize_relationships({entry_id: 1, depth: "abc"})`                                   |
| `get_cross_project_insights`      | `min_entries`          | `get_cross_project_insights({min_entries: "abc"})`                                            |
| `team_semantic_search`            | `limit`                | `team_semantic_search({query: "test", limit: "abc"})`                                         |
| `team_semantic_search`            | `similarity_threshold` | `team_semantic_search({query: "test", similarity_threshold: "abc"})`                          |
| `team_get_cross_project_insights` | `min_entries`          | `team_get_cross_project_insights({min_entries: "abc"})`                                       |

### Reporting Format

- ❌ Fail: Tool errors or produces incorrect results (include error message)
- ⚠️ Issue: Unexpected behavior or improvement opportunity
- 📦 Payload: Unnecessarily large response that could be optimized

---

## Phase 5: Data Integrity & Round-Trip Tests

> [!NOTE]
> These tests verify that data survives full lifecycles and that operations compose correctly.

### 5.1 Create → Read Round-Trip

| Test                       | Steps                                                                                                                                                                                                                                         | Expected Result                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| All fields persist         | 1. `create_entry(content: "RT test", entry_type: "planning", tags: ["rt"], pr_number: 99, pr_status: "open", workflow_run_id: 1, workflow_name: "CI", workflow_status: "completed", project_number: 5)` 2. `get_entry_by_id(entry_id: <new>)` | All fields match: `prNumber`, `prStatus`, `workflowRunId`, `workflowName`, `workflowStatus`, `projectNumber` |
| share_with_team round-trip | 1. `create_entry(content: "Shared RT", share_with_team: true)` 2. `team_search(query: "Shared RT")`                                                                                                                                           | Entry appears in team search with `author` field                                                             |

### 5.2 Soft Delete Isolation

| Test                        | Steps                                                                                               | Expected Result                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Hidden from search          | 1. Create entry 2. `delete_entry(entry_id: <id>, permanent: false)` 3. `search_entries(query: ...)` | Entry does not appear in search results                                                 |
| Hidden from recent          | Same setup, then `get_recent_entries`                                                               | Entry does not appear in recent results                                                 |
| Hidden from semantic search | Same setup, then `semantic_search(query: ...)`                                                      | Entry does not appear in semantic results                                               |
| Still fetchable by ID       | Same setup, then `get_entry_by_id(entry_id: <id>)`                                                  | ⚠️ Verify behavior — document whether soft-deleted entries are retrievable by direct ID |

### 5.3 Backup → Restore Integrity

| Test                    | Steps                                                                                                                              | Expected Result                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Entry count preserved   | 1. Note `get_statistics` total 2. `backup_journal` 3. Create 2 entries 4. `restore_backup` 5. `get_statistics`                     | Total matches pre-backup count             |
| Specific entry survives | 1. Create entry with known content 2. `backup_journal` 3. `delete_entry(permanent: true)` 4. `restore_backup` 5. `get_entry_by_id` | Entry is restored with original content    |
| Relationships survive   | 1. Link two entries 2. `backup_journal` 3. Delete one entry 4. `restore_backup` 5. `visualize_relationships`                       | Relationship graph is intact after restore |
| Tags survive            | 1. `merge_tags` 2. `backup_journal` 3. `restore_backup` 4. `list_tags`                                                             | Tags reflect post-merge state from backup  |

### 5.4 Merge Tags Verification

| Test                      | Steps                                                                                                                             | Expected Result                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Entries re-tagged         | 1. Create entries with "old-tag" 2. `merge_tags(source_tag: "old-tag", target_tag: "new-tag")` 3. `search_entries` for each entry | Each entry now has "new-tag", not "old-tag"   |
| Source tag removed        | After merge, `list_tags`                                                                                                          | "old-tag" no longer appears                   |
| Target tag count accurate | After merge, `list_tags`                                                                                                          | "new-tag" count equals sum of original counts |

---

## Phase 6: Boundary Value Tests

> [!NOTE]
> These tests exercise min/max limits and edge values defined in Zod schemas.

| Test                            | Command/Action                                              | Expected Result                                      |
| ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Content at max length           | `create_entry(content: <50000 chars>)`                      | Entry created successfully                           |
| Content empty string            | `create_entry(content: "")`                                 | Structured error: min length 1                       |
| get_recent limit=0              | `get_recent_entries(limit: 0)`                              | Structured error or empty results — verify behavior  |
| get_recent limit=500            | `get_recent_entries(limit: 500)`                            | Returns up to 500 entries (max boundary)             |
| get_recent limit=501            | `get_recent_entries(limit: 501)`                            | Structured error: exceeds max 500                    |
| search limit=500                | `search_entries(query: "test", limit: 500)`                 | Returns up to 500 entries                            |
| search limit=501                | `search_entries(query: "test", limit: 501)`                 | Structured error: exceeds max 500                    |
| semantic_search limit=500       | `semantic_search(query: "test", limit: 500)`                | Returns up to 500 entries                            |
| semantic threshold=0.0          | `semantic_search(query: "test", similarity_threshold: 0.0)` | Returns all indexed entries (no threshold filtering) |
| semantic threshold=1.0          | `semantic_search(query: "test", similarity_threshold: 1.0)` | Returns zero or very few results (exact match only)  |
| visualize depth=1               | `visualize_relationships(entry_id: <A>, depth: 1)`          | Only direct relationships (no transitive)            |
| visualize depth=3               | `visualize_relationships(entry_id: <A>, depth: 3)`          | Maximum depth traversal                              |
| cleanup keep_count=1            | `cleanup_backups(keep_count: 1)`                            | Keeps only 1 backup, deletes rest                    |
| cleanup keep_count=0            | `cleanup_backups(keep_count: 0)`                            | Structured error: min 1                              |
| get_statistics invalid group_by | `get_statistics(group_by: "invalid")`                       | Structured error or validation failure               |
| export limit=500                | `export_entries(format: "json", limit: 500)`                | Returns up to 500 entries                            |

---

## Phase 7: Implementation Bug Detection

> [!IMPORTANT]
> These tests are designed to surface known or suspected implementation bugs where tool handlers accept parameters via Zod but silently ignore them. If a filter has no effect, report it as ⚠️ — the handler accepts the parameter but doesn't pass it to the database query.

### 7.1 Silent Filter Bugs

| Test                       | Command/Action                                                                                                              | Verification                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| export_entries tag filter  | 1. Create entries with tag "export-test" and without 2. `export_entries(format: "json", tags: ["export-test"], limit: 100)` | ⚠️ All results should have "export-test" tag — if unfiltered, handler bug                   |
| export_entries date filter | `export_entries(format: "json", start_date: "2099-01-01", end_date: "2099-12-31")`                                          | ⚠️ Should return 0 entries for future dates — if returns entries, handler ignores dates     |
| export_entries type filter | `export_entries(format: "json", entry_types: ["milestone"], limit: 100)`                                                    | ⚠️ Should only return "milestone" type — if unfiltered, handler bug                         |
| get_statistics date filter | `get_statistics(start_date: "2099-01-01", end_date: "2099-12-31")`                                                          | ⚠️ Should return 0 entries for future dates — if returns all entries, handler ignores dates |
| get_statistics project     | `get_statistics(project_breakdown: true)`                                                                                   | ⚠️ Verify if response includes project-level breakdown (currently not implemented)          |
| search_by_date_range issue | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", issue_number: 44)`                                  | ⚠️ Verify if issue filter applies (handler may not pass to DB query)                        |
| search_by_date_range PR    | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", pr_number: 67)`                                     | ⚠️ Verify if PR filter applies (handler may not pass to DB query)                           |
| search_by_date_range wf    | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", workflow_run_id: 999)`                              | ⚠️ Verify if workflow filter applies (handler may not pass to DB query)                     |

### 7.2 OutputSchema Compatibility on Error Paths

> [!NOTE]
> Some tools return extra fields in error responses that aren't declared in their outputSchema. This can cause `-32602` errors when `structuredContent` validation is strict.

| Test                              | Command/Action                                                             | Verification                                                                         |
| --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| move_kanban_item invalid status   | `move_kanban_item(project_number: 5, item_id: <id>, target_status: "Bad")` | Error response includes `availableStatuses` — verify this doesn't break outputSchema |
| get_repo_insights partial failure | `get_repo_insights(sections: "traffic")` (may require push access)         | Verify partial API failures don't produce fields outside outputSchema                |

### 7.3 Duplicate Relationship Direction

| Test                     | Command/Action                                                      | Verification                                                                             |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Same-direction duplicate | `link_entries(from: A, to: B, type: "references")` twice            | Second call returns `duplicate: true` — correct                                          |
| Reverse-direction        | `link_entries(from: B, to: A, type: "references")` after A→B exists | ⚠️ Creates a second relationship (only same-direction checked) — document if intentional |

---

## Test Execution Order

0. **Phase 0**: outputSchema Validation (verify structured responses across all 61 tools)
1. **Phase 1**: All Resources (static + template, happy path + error paths)
2. **Phase 2**: GitHub Integration (happy paths, lifecycle, milestones, insights, copilot, cleanup)
3. **Phase 3**: Prompt Handler Verification (scripted + response shape for all 16 prompts)
4. **Phase 4**: Structured Error Response Verification (expanded error path testing for all groups)
5. **Phase 5**: Data Integrity & Round-Trip Tests (create→read, backup→restore, merge→verify)
6. **Phase 6**: Boundary Value Tests (min/max limits, Zod schema edges)
7. **Phase 7**: Implementation Bug Detection (silent filter bugs, schema compatibility, duplicate directions)

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

### Prompt Handlers (Phase 3)

- [ ] All 16 prompts return valid `GetPromptResult` with `messages` array
- [ ] Every message has `role: 'user'` and non-empty `content.text`
- [ ] Nonexistent prompt name returns MCP error (not crash)

### Structured Error Verification (Phase 4)

- [ ] **All tools return structured handler errors — no raw MCP error frames**
- [ ] **Zod validation errors (empty params, wrong types) return `{ success: false, error: "..." }`**

### Data Integrity (Phase 5)

- [ ] All `create_entry` fields survive round-trip through `get_entry_by_id`
- [ ] Soft-deleted entries are hidden from all search/recent; direct ID fetch behavior documented
- [ ] Backup → restore preserves entry counts, specific entries, relationships, and tags
- [ ] `merge_tags` results verified: entries re-tagged, source removed, target count accurate

### Boundary Values (Phase 6)

- [ ] Content at max length (50,000 chars) creates successfully
- [ ] Empty content rejected
- [ ] Limit boundaries: 0, 500, 501 behave correctly
- [ ] `similarity_threshold` at 0.0 and 1.0 produce expected result counts

### Implementation Bugs (Phase 7)

- [ ] ⚠️ `export_entries` filters (`tags`, `start_date/end_date`, `entry_types`) functional or documented
- [ ] ⚠️ `get_statistics` filters (`start_date`, `end_date`, `project_breakdown`) functional or documented
- [ ] ⚠️ `move_kanban_item` error path `availableStatuses` field doesn't break outputSchema
- [ ] ⚠️ Reverse-direction relationship duplicate behavior documented as intentional or fixed
