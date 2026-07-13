# Re-Test memory-journal-mcp — Code Mode: GitHub Tools

Test all 16 GitHub tools via Code Mode: read-only lookups, error paths, Kanban operations, issue lifecycle, milestone CRUD, insights, and Copilot reviews.

**Scope:** 1 tool (`mj_execute_code`), Phase 25 — ~16 test cases covering all GitHub tools via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 25C: GitHub Tools (Part 2)\n\n### 25.4 Issue Lifecycle & Milestone CRUD

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
