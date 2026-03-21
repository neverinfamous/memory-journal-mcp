# Test memory-journal-mcp — Pass 2: Validation & Edge Cases

Exhaustively validate the memory-journal-mcp server's output schemas, error handling, data integrity, boundary values, and implementation correctness.

**Scope:** Cross-cutting validation of all 61 tools and 24 resources — this pass re-exercises tools tested in Pass 1 with different concerns (schema shape, error structure, boundary values, silent bugs). Phases 11, 12, 12b, 13-15.

**Prerequisites:**

- Pass 1 must have completed successfully and any fixes applied before running Pass 2.
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

## Phase 11: outputSchema Validation

> [!NOTE]
> **61 tools** now return `structuredContent` validated against Zod output schemas.
> Verify each response is structured JSON (not raw text).

### 11.1 Original 5 Tools

| Tool                   | Verification                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_recent_entries`   | Response has `entries` array with typed objects                                                                                                |
| `search_entries`       | Response has `entries` array with `id`, `timestamp`, `content`, etc.                                                                           |
| `search_by_date_range` | Response has `entries` array                                                                                                                   |
| `get_entry_by_id`      | Response has `entry` object with `relationships` array                                                                                         |
| `get_statistics`       | Response has `totalEntries`, `entriesByType`, `entriesByPeriod`, `decisionDensity`, `relationshipComplexity`, `activityTrend`, `causalMetrics` |

### 11.2 Core Read Tools

| Tool                         | Schema                             | Verification                                                   |
| ---------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `semantic_search`            | `SemanticSearchOutputSchema`       | `query`, `entries` (with `similarity`), `count`                |
| `list_tags`                  | `TagsListOutputSchema`             | `tags` array with `name`, `count` per tag                      |
| `get_vector_index_stats`     | `VectorStatsOutputSchema`          | `available`, `itemCount`, `modelName`, `dimensions`, `success` |
| `visualize_relationships`    | `VisualizationOutputSchema`        | `entry_count`, `relationship_count`, `mermaid`, `legend`       |
| `get_cross_project_insights` | `CrossProjectInsightsOutputSchema` | `project_count`, `total_entries`, `projects` array             |

### 11.3 Mutation Tools

| Tool                   | Schema                    | Verification                                                            |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `create_entry`         | `CreateEntryOutputSchema` | `success: true`, `entry` object                                         |
| `create_entry_minimal` | `CreateEntryOutputSchema` | `success: true`, `entry` object                                         |
| `update_entry`         | `UpdateEntryOutputSchema` | `success`, `entry` (or `error`)                                         |
| `delete_entry`         | `DeleteEntryOutputSchema` | `success`, `entryId`, `permanent`                                       |
| `link_entries`         | `LinkEntriesOutputSchema` | `success: true`, `relationship` object, optional `duplicate`, `message` |
| `merge_tags`           | `MergeTagsOutputSchema`   | `success`, `sourceTag`, `targetTag`, `entriesUpdated`, `message`        |

### 11.4 GitHub Tools

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

### 11.5 Backup Tools

| Tool              | Schema                       | Verification                                                                                   |
| ----------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `backup_journal`  | `BackupResultOutputSchema`   | `success`, `message`, `filename`, `path`, `sizeBytes`                                          |
| `list_backups`    | `BackupsListOutputSchema`    | `backups` array, `total`, `backupsDirectory`                                                   |
| `cleanup_backups` | `CleanupBackupsOutputSchema` | `success`, `deleted` array, `deletedCount`, `keptCount`                                        |
| `restore_backup`  | `RestoreResultOutputSchema`  | `success`, `message`, `restoredFrom`, `previousEntryCount`, `newEntryCount`, `revertedChanges` |

### 11.6 Remaining Tools

| Tool                             | Schema                                   | Verification                                                 |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `test_simple`                    | `TestSimpleOutputSchema`                 | `message` string                                             |
| `export_entries`                 | `ExportEntriesOutputSchema`              | `format`, `entries` (JSON) or `content` (markdown)           |
| `rebuild_vector_index`           | `RebuildVectorIndexOutputSchema`         | `success`, `entriesIndexed`, optional `failedEntries`        |
| `add_to_vector_index`            | `AddToVectorIndexOutputSchema`           | `success`, `entryId`                                         |
| `move_kanban_item`               | `MoveKanbanItemOutputSchema`             | `success`, `itemId`, `newStatus`, `projectNumber`, `message` |
| `create_github_issue_with_entry` | `CreateGitHubIssueWithEntryOutputSchema` | `success`, `issue`, `journalEntry`, optional `project`       |
| `close_github_issue_with_entry`  | `CloseGitHubIssueWithEntryOutputSchema`  | `success`, `issue`, `journalEntry`, optional `kanban`        |

### 11.7 Milestone Tools

| Tool                      | Schema                              | Verification                                                     |
| ------------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `get_github_milestones`   | `GitHubMilestonesListOutputSchema`  | `milestones` array with `completion_percentage`, `total`         |
| `get_github_milestone`    | `GitHubMilestoneResultOutputSchema` | `milestone` object with number, title, state, open/closed counts |
| `create_github_milestone` | `CreateMilestoneOutputSchema`       | `success`, `milestone` (number, title, url), `message`           |
| `update_github_milestone` | `UpdateMilestoneOutputSchema`       | `success`, `milestone` (updated fields), `message`               |
| `delete_github_milestone` | `DeleteMilestoneOutputSchema`       | `success`, `message`                                             |

### 11.8 Team Tools

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

## Phase 12: Static Resources

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
| Help index        | `memory://help`              | Lists all tool groups with counts, descriptions, and `totalTools`                                                                 |
| Help group detail | `memory://help/{group}`      | Per-group tool listing with parameters, descriptions, and annotations (test with `memory://help/core`)                             |

---

## Phase 12b: Structured Error Response Verification

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

## Phase 13: Data Integrity & Round-Trip Tests

> [!NOTE]
> These tests verify that data survives full lifecycles and that operations compose correctly. Run after Phases 1-10 (Pass 1).

### 13.1 Create → Read Round-Trip

| Test                       | Steps                                                                                                                                                                                                                                         | Expected Result                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| All fields persist         | 1. `create_entry(content: "RT test", entry_type: "planning", tags: ["rt"], pr_number: 99, pr_status: "open", workflow_run_id: 1, workflow_name: "CI", workflow_status: "completed", project_number: 5)` 2. `get_entry_by_id(entry_id: <new>)` | All fields match: `prNumber`, `prStatus`, `workflowRunId`, `workflowName`, `workflowStatus`, `projectNumber` |
| share_with_team round-trip | 1. `create_entry(content: "Shared RT", share_with_team: true)` 2. `team_search(query: "Shared RT")`                                                                                                                                           | Entry appears in team search with `author` field                                                             |

### 13.2 Soft Delete Isolation

| Test                        | Steps                                                                                               | Expected Result                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Hidden from search          | 1. Create entry 2. `delete_entry(entry_id: <id>, permanent: false)` 3. `search_entries(query: ...)` | Entry does not appear in search results                                                 |
| Hidden from recent          | Same setup, then `get_recent_entries`                                                               | Entry does not appear in recent results                                                 |
| Hidden from semantic search | Same setup, then `semantic_search(query: ...)`                                                      | Entry does not appear in semantic results                                               |
| Still fetchable by ID       | Same setup, then `get_entry_by_id(entry_id: <id>)`                                                  | ⚠️ Verify behavior — document whether soft-deleted entries are retrievable by direct ID |

### 13.3 Backup → Restore Integrity

| Test                    | Steps                                                                                                                              | Expected Result                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Entry count preserved   | 1. Note `get_statistics` total 2. `backup_journal` 3. Create 2 entries 4. `restore_backup` 5. `get_statistics`                     | Total matches pre-backup count             |
| Specific entry survives | 1. Create entry with known content 2. `backup_journal` 3. `delete_entry(permanent: true)` 4. `restore_backup` 5. `get_entry_by_id` | Entry is restored with original content    |
| Relationships survive   | 1. Link two entries 2. `backup_journal` 3. Delete one entry 4. `restore_backup` 5. `visualize_relationships`                       | Relationship graph is intact after restore |
| Tags survive            | 1. `merge_tags` 2. `backup_journal` 3. `restore_backup` 4. `list_tags`                                                             | Tags reflect post-merge state from backup  |

### 13.4 Merge Tags Verification

| Test                      | Steps                                                                                                                             | Expected Result                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Entries re-tagged         | 1. Create entries with "old-tag" 2. `merge_tags(source_tag: "old-tag", target_tag: "new-tag")` 3. `search_entries` for each entry | Each entry now has "new-tag", not "old-tag"   |
| Source tag removed        | After merge, `list_tags`                                                                                                          | "old-tag" no longer appears                   |
| Target tag count accurate | After merge, `list_tags`                                                                                                          | "new-tag" count equals sum of original counts |

---

## Phase 14: Boundary Value Tests

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

## Phase 15: Implementation Bug Detection

> [!IMPORTANT]
> These tests are designed to surface known or suspected implementation bugs where tool handlers accept parameters via Zod but silently ignore them. If a filter has no effect, report it as ⚠️ — the handler accepts the parameter but doesn't pass it to the database query.

### 15.1 Silent Filter Bugs

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

### 15.2 OutputSchema Compatibility on Error Paths

> [!NOTE]
> Some tools return extra fields in error responses that aren't declared in their outputSchema. This can cause `-32602` errors when `structuredContent` validation is strict.

| Test                              | Command/Action                                                             | Verification                                                                         |
| --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| move_kanban_item invalid status   | `move_kanban_item(project_number: 5, item_id: <id>, target_status: "Bad")` | Error response includes `availableStatuses` — verify this doesn't break outputSchema |
| get_repo_insights partial failure | `get_repo_insights(sections: "traffic")` (may require push access)         | Verify partial API failures don't produce fields outside outputSchema                |

### 15.3 Duplicate Relationship Direction

| Test                     | Command/Action                                                      | Verification                                                                             |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Same-direction duplicate | `link_entries(from: A, to: B, type: "references")` twice            | Second call returns `duplicate: true` — correct                                          |
| Reverse-direction        | `link_entries(from: B, to: A, type: "references")` after A→B exists | ⚠️ Creates a second relationship (only same-direction checked) — document if intentional |

---

## Test Execution Order

1. **Phase 11**: outputSchema Validation (verify structured responses across all 61 tools)
2. **Phase 12**: Static Resources (comprehensive resource check with cross-verification)
3. **Phase 12b**: Structured Error Response Verification (expanded error path testing for all groups)
4. **Phase 13**: Data Integrity & Round-Trip Tests (create→read, backup→restore, merge→verify)
5. **Phase 14**: Boundary Value Tests (min/max limits, Zod schema edges)
6. **Phase 15**: Implementation Bug Detection (silent filter bugs, schema compatibility, duplicate directions)

---

## Success Criteria

### outputSchema Validation (Phase 11)

- [ ] All **44** outputSchema tools return `structuredContent` (not raw text)
- [ ] All 17 static resources return valid data
- [ ] All 7 template resources work with valid parameters

### Static Resources (Phase 12)

- [ ] `memory://significant` includes `importance` field and is sorted by importance (primary) then timestamp (secondary)
- [ ] `memory://tags` tag counts match `list_tags` output
- [ ] `memory://statistics` structured stats match `get_statistics` output
- [ ] `memory://github/insights` returns compact stats including traffic aggregates
- [ ] `memory://graph/recent` uses harmonized arrows (`-->`, `==>`, `-.->`, `--x`, `<-->`)
- [ ] `memory://graph/actions` handles graceful output when no workflow entries exist
- [ ] `memory://actions/recent` handles graceful output when no workflow entries exist
- [ ] `memory://instructions` references all 61 tools and key resources

### Structured Error Verification (Phase 12b)

- [ ] **All tools return structured handler errors — no raw MCP error frames**
- [ ] **Zod validation errors (empty params, wrong types) return `{ success: false, error: "..." }`**

### Data Integrity (Phase 13)

- [ ] All `create_entry` fields survive round-trip through `get_entry_by_id`
- [ ] `share_with_team: true` entries appear in both personal and team search
- [ ] Soft-deleted entries are hidden from all search/recent but behavior for direct ID fetch is documented
- [ ] Backup → restore preserves entry counts, specific entries, relationships, and tags
- [ ] `merge_tags` results verified: entries re-tagged, source removed, target count accurate

### Boundary Values (Phase 14)

- [ ] Content at max length (50,000 chars) creates successfully
- [ ] Empty content rejected
- [ ] Limit boundaries: 0, 500, 501 behave correctly for `get_recent_entries`, `search_entries`, `semantic_search`
- [ ] `similarity_threshold` at 0.0 and 1.0 produce expected result counts
- [ ] `cleanup_backups(keep_count: 0)` rejected, `keep_count: 1` accepted

### Implementation Bugs (Phase 15)

- [ ] ⚠️ `export_entries` filters (`tags`, `start_date/end_date`, `entry_types`) are either functional or documented as no-ops
- [ ] ⚠️ `get_statistics` filters (`start_date`, `end_date`, `project_breakdown`) are either functional or documented as no-ops
- [ ] ⚠️ `search_by_date_range` extra filters (`issue_number`, `pr_number`, `workflow_run_id`) are either functional or documented as no-ops
- [ ] ⚠️ `move_kanban_item` error path `availableStatuses` field doesn't break outputSchema
- [ ] ⚠️ Reverse-direction relationship duplicate behavior is documented as intentional or fixed
