# Test memory-journal-mcp — GitHub Integration

**Scope:** 16 GitHub tools — read-only tools, issue lifecycle, Kanban, milestones, repository insights, Copilot reviews, and test cleanup.

**Execution Strategy:** Use direct MCP tools, not Code Mode or scripts! Code Mode is preferred to scripts if absolutely necesasary to supplement direct MCP tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected. Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. **USER** verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

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

## Success Criteria

- [ ] GitHub issue lifecycle tools create/close issues correctly
- [ ] `create_github_issue_with_entry` with `body`, `labels`, `initial_status`, `entry_content` works
- [ ] `create_github_issue_with_entry` with `milestone_number` assigns issue to milestone
- [ ] `close_github_issue_with_entry` returns structured error for already-closed issues
- [ ] `close_github_issue_with_entry` with `move_to_done: true` behavior correct with/without `DEFAULT_PROJECT_NUMBER`
- [ ] `get_github_issues` and `get_github_prs` with `state: "closed"` and `state: "all"` work
- [ ] Milestone CRUD lifecycle works end-to-end (create → update → close → delete)
- [ ] `memory://milestones/{number}` returns milestone with completion %, issue counts, and hint
- [ ] `get_repo_insights` returns correct data based on `sections` parameter
- [ ] `get_copilot_reviews` — referenced in test docs but not re-executed (verified in schema check only; see prior sessions)
- [ ] All GitHub test artifacts cleaned up after testing
