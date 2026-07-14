

### 25.4 Issue Lifecycle & Milestone CRUD

> [!CAUTION]
> Creates and closes real GitHub issues and milestones. Clean up in Phase 25.6.

```javascript
// Test code — Issue Lifecycle (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const created = await mj.github.createGithubIssueWithEntry({
  title: 'CM4 Test: Code Mode Issue',
  body: 'Created via Code Mode test',
  labels: ['test'],
  workspace_id: "test-ws",
  tags: ['codemode4-test'],
})
const issueNum = created.issue?.number

const closed = await mj.github.closeGithubIssueWithEntry({
  issue_number: issueNum,
  resolution_notes: 'CM4 test complete',
  comment: 'Closing via Code Mode',
  move_to_done: true,
  workspace_id: "test-ws",
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

// Copilot reviews (use a dynamic PR number)
const prs = await mj.github.getGithubPrs({ limit: 1 })
const prNum = prs.pullRequests?.[0]?.number
let reviewed = null
if (prNum) {
  reviewed = await mj.github.getCopilotReviews({ pr_number: prNum })
}

return {
  hasStars: typeof stars.stars === 'number',
  hasForks: typeof stars.forks === 'number',
  trafficHasClones: traffic.traffic?.clones !== undefined || traffic.error !== undefined,
  allSections: !!all,
  reviewState: reviewed ? reviewed.state || (reviewed.success === false ? 'none' : null) : 'none',
  reviewComments: reviewed ? reviewed.commentCount : 0,
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
| Verify no orphans | `const b = await mj.github.getKanbanBoard({ workspace_id: "test-ws" }); const testItems = b.columns?.flatMap(c => c.items ?? []).filter(i => i.title?.includes("CM4")); return { orphans: testItems?.length ?? 0 };` |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- All 16 GitHub tools callable via `mj.github.*`
- `get_github_context` returns repo and branch info
- `get_github_issues` and `get_github_prs` support `state` filter (open/closed/all)
- Single issue/PR lookups return expected fields
- Nonexistent issue/PR/milestone return structured errors
- Kanban board returns columns with statusOptions
- `move_kanban_item` with invalid status returns error with `availableStatuses`
- Issue lifecycle (create → close) works end-to-end via Code Mode
- `close_github_issue_with_entry` returns error for already-closed issues
- Milestone CRUD lifecycle (create → update → close → delete) works via Code Mode
- `get_repo_insights` returns star/fork data
- `get_copilot_reviews` returns review state
- All test artifacts cleaned up
