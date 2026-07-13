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
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
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
const board = await mj.github.getKanbanBoard({ workspace_id: "test-ws" })
const hasItems = board.columns?.some((c) => c.items?.length > 0)
const itemId = board.columns?.flatMap((c) => c.items ?? []).find((i) => i)?.id

let moveResult = null
if (itemId) {
  moveResult = await mj.github.moveKanbanItem({
    workspace_id: "test-ws",
    item_id: itemId,
    target_status: 'In progress',
  })
}

const badMove = await mj.github.moveKanbanItem({
  workspace_id: "test-ws",
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
