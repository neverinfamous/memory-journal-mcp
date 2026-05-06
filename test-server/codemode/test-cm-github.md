# Re-Test memory-journal-mcp — Code Mode: GitHub Tools

Test all 16 GitHub tools via Code Mode: read-only lookups, error paths, Kanban operations, issue lifecycle, milestone CRUD, insights, and Copilot reviews.

**Scope:** 1 tool (`mj_execute_code`), Phase 25 — ~16 test cases covering all GitHub tools via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 25: GitHub Tools via Code Mode (16 tools)

> [!CAUTION]
> Phase 25.3–25.4 create and modify **real GitHub issues and milestones**. Clean up after testing.

### 25.1 Read-Only GitHub Tools

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const ctx = await mj.github.getGithubContext({})
const issues = await mj.github.getGithubIssues({ limit: 3 })
const closedIssues = await mj.github.getGithubIssues({ state: 'closed', limit: 2 })
const prs = await mj.github.getGithubPrs({ limit: 3 })
const closedPrs = await mj.github.getGithubPrs({ state: 'closed', limit: 2 })
const milestones = await mj.github.getGithubMilestones({})

// Single-item lookups (use known numbers from context)
const issueNum = issues.issues?.[0]?.number
const prNum = prs.pullRequests?.[0]?.number ?? closedPrs.pullRequests?.[0]?.number
const singleIssue = issueNum ? await mj.github.getGithubIssue({ issue_number: issueNum }) : null
const singlePr = prNum ? await mj.github.getGithubPr({ pr_number: prNum }) : null

return {
  contextHasRepo: !!ctx.repoName,
  contextHasBranch: !!ctx.branch,
  issueCount: issues.count,
  issueMilestoneField: typeof issues.issues?.[0]?.milestone,
  closedIssueCount: closedIssues.count,
  prCount: prs.count,
  closedPrCount: closedPrs.count,
  milestoneCount: milestones.count,
  singleIssueHasBody: !!singleIssue?.issue?.body !== undefined,
  singlePrHasDraft: singlePr?.pullRequest?.draft !== undefined,
}
```

| Check              | Expected |
| ------------------ | -------- |
| `contextHasRepo`   | `true`   |
| `contextHasBranch` | `true`   |
| `issueCount`       | ≥ 0      |
| `milestoneCount`   | ≥ 0      |

### 25.2 GitHub Error Paths

| Test                  | Code                                                                       | Expected Result                            |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| Nonexistent issue     | `return await mj.github.getGithubIssue({ issue_number: 999999 });`         | `{ error: "Issue #999999 not found" }`     |
| Nonexistent PR        | `return await mj.github.getGithubPr({ pr_number: 999999 });`               | `{ error: "PR #999999 not found" }`        |
| Nonexistent milestone | `return await mj.github.getGithubMilestone({ milestone_number: 999999 });` | `{ error: "Milestone #999999 not found" }` |
| Nonexistent Kanban    | `return await mj.github.getKanbanBoard({ project_number: 99999 });`        | Structured error with project not found    |

### 25.3 Kanban Tools

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const board = await mj.github.getKanbanBoard({ project_number: 5 })
const hasItems = board.columns?.some((c) => c.items?.length > 0)
const itemId = board.columns?.flatMap((c) => c.items ?? []).find((i) => i)?.id

let moveResult = null
if (itemId) {
  moveResult = await mj.github.moveKanbanItem({
    project_number: 5,
    item_id: itemId,
    target_status: 'In progress',
  })
}

const badMove = await mj.github.moveKanbanItem({
  project_number: 5,
  item_id: itemId || 'fake-id',
  target_status: 'Nonexistent Status',
})

return {
  boardHasColumns: Array.isArray(board.columns),
  statusOptions: board.statusOptions,
  hasItems,
  moveSuccess: moveResult?.success,
  badMoveError: badMove.success === false,
  badMoveHasStatuses: Array.isArray(badMove.availableStatuses),
}
```

| Check                | Expected                |
| -------------------- | ----------------------- |
| `boardHasColumns`    | `true`                  |
| `statusOptions`      | Array of valid statuses |
| `moveSuccess`        | `true` (if items exist) |
| `badMoveError`       | `true`                  |
| `badMoveHasStatuses` | `true`                  |

### 25.4 Issue Lifecycle & Milestone CRUD

> [!CAUTION]
> Creates and closes real GitHub issues and milestones. Clean up in Phase 25.6.

```javascript
// Test code — Issue Lifecycle (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const created = await mj.github.createGithubIssueWithEntry({
  title: 'CM4 Test: Code Mode Issue',
  body: 'Created via Code Mode test',
  labels: ['test'],
  project_number: 5,
  tags: ['codemode4-test'],
})
const issueNum = created.issue?.number

const closed = await mj.github.closeGithubIssueWithEntry({
  issue_number: issueNum,
  resolution_notes: 'CM4 test complete',
  comment: 'Closing via Code Mode',
  move_to_done: true,
  project_number: 5,
})

const alreadyClosed = await mj.github.closeGithubIssueWithEntry({
  issue_number: issueNum,
})

return {
  createSuccess: created.success,
  issueNumber: issueNum,
  hasJournal: !!created.journalEntry,
  hasProject: !!created.project,
  closeSuccess: closed.success,
  closeHasKanban: !!closed.kanban,
  kanbanMoved: closed.kanban?.moved,
  alreadyClosedError: alreadyClosed.success === false,
  alreadyClosedMsg: alreadyClosed.error,
}
```

| Check                | Expected |
| -------------------- | -------- |
| `createSuccess`      | `true`   |
| `hasJournal`         | `true`   |
| `closeSuccess`       | `true`   |
| `kanbanMoved`        | `true`   |
| `alreadyClosedError` | `true`   |

```javascript
// Test code — Milestone CRUD (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const ms = await mj.github.createGithubMilestone({
  title: 'CM4 Test Milestone',
  description: 'Created via Code Mode',
  due_on: '2026-12-31',
})
const msNum = ms.milestone?.number

const updated = await mj.github.updateGithubMilestone({
  milestone_number: msNum,
  description: 'Updated via Code Mode',
})

const closed = await mj.github.updateGithubMilestone({
  milestone_number: msNum,
  state: 'closed',
})

const detail = await mj.github.getGithubMilestone({
  milestone_number: msNum,
})

const deleted = await mj.github.deleteGithubMilestone({
  milestone_number: msNum,
  confirm: true,
})

return {
  createSuccess: ms.success,
  msNumber: msNum,
  updateSuccess: updated.success,
  closeSuccess: closed.success,
  detailState: detail.milestone?.state,
  deleteSuccess: deleted.success,
}
```

| Check           | Expected   |
| --------------- | ---------- |
| `createSuccess` | `true`     |
| `updateSuccess` | `true`     |
| `detailState`   | `"closed"` |
| `deleteSuccess` | `true`     |

### 25.5 Repo Insights & Copilot Reviews

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const stars = await mj.github.getRepoInsights({})
const traffic = await mj.github.getRepoInsights({ sections: 'traffic' })
const all = await mj.github.getRepoInsights({ sections: 'all' })

// Copilot reviews (use a known PR number)
const reviewed = await mj.github.getCopilotReviews({ pr_number: 1 })

return {
  hasStars: typeof stars.stars === 'number',
  hasForks: typeof stars.forks === 'number',
  trafficHasClones: traffic.traffic?.clones !== undefined || traffic.error !== undefined,
  allSections: !!all,
  reviewState: reviewed.state,
  reviewComments: reviewed.commentCount,
}
```

| Check         | Expected                              |
| ------------- | ------------------------------------- |
| `hasStars`    | `true`                                |
| `hasForks`    | `true`                                |
| `reviewState` | String (`"none"`, `"approved"`, etc.) |

### 25.6 GitHub Cleanup

> [!IMPORTANT]
> Run after all Phase 25 tests. Check for any unclosed test issues or milestones.

| Cleanup Step      | Code                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verify no orphans | `const b = await mj.github.getKanbanBoard({ project_number: 5 }); const testItems = b.columns?.flatMap(c => c.items ?? []).filter(i => i.title?.includes("CM4")); return { orphans: testItems?.length ?? 0 };` |

---

## Success Criteria

- [x] All 16 GitHub tools callable via `mj.github.*`
- [x] `get_github_context` returns repo and branch info
- [x] `get_github_issues` and `get_github_prs` support `state` filter (open/closed/all)
- [x] Single issue/PR lookups return expected fields
- [x] Nonexistent issue/PR/milestone return structured errors
- [x] Kanban board returns columns with statusOptions
- [x] `move_kanban_item` with invalid status returns error with `availableStatuses`
- [x] Issue lifecycle (create → close) works end-to-end via Code Mode
- [x] `close_github_issue_with_entry` returns error for already-closed issues
- [x] Milestone CRUD lifecycle (create → update → close → delete) works via Code Mode
- [x] `get_repo_insights` returns star/fork data
- [x] `get_copilot_reviews` returns review state
- [x] All test artifacts cleaned up
