# Re-Test memory-journal-mcp — Code Mode: Payload Optimization

Test all 4 payload optimization features via Code Mode: Kanban throttling (`summary_only`, `item_limit`), body truncation (`truncate_body`, `include_comments`), `MAX_QUERY_LIMIT` enforcement (with keyset cursors), and Code Mode result size cap.

**Scope:** 1 tool (`mj_execute_code`), Phase 30 — ~4 test scripts covering all payload optimization features via Code Mode.

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

## Phase 30: Payload Optimization via Code Mode

### 30.1 Kanban Throttling

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const failures = []

// Summary mode: items should be empty, itemCount present
const summary = await mj.github.getKanbanBoard({ workspace_id: "test-ws", summary_only: true })
if (summary.columns) {
  if (!summary.summaryOnly) failures.push('summaryOnly flag not set')
  for (const col of summary.columns) {
    if (col.items?.length > 0)
      failures.push(`summaryMode: column "${col.name}" has ${col.items.length} items, expected 0`)
    if (typeof col.itemCount !== 'number')
      failures.push(`summaryMode: column "${col.name}" missing itemCount`)
  }
} else if (summary.success !== false) {
  failures.push('summary mode returned no columns and no error')
}

// Item limit: truncated flag on columns exceeding limit
const limited = await mj.github.getKanbanBoard({ workspace_id: "test-ws", item_limit: 2 })
if (limited.columns) {
  for (const col of limited.columns) {
    if (col.items?.length > 2)
      failures.push(`itemLimit: column "${col.name}" has ${col.items.length} items, expected ≤2`)
    if (typeof col.itemCount !== 'number')
      failures.push(`itemLimit: column "${col.name}" missing itemCount`)
    if (col.itemCount > 2 && col.truncated !== true)
      failures.push(`itemLimit: column "${col.name}" should be truncated`)
  }
}

// Zero limit = summary mode
const zeroLimit = await mj.github.getKanbanBoard({ workspace_id: "test-ws", item_limit: 0 })
if (zeroLimit.columns && !zeroLimit.summaryOnly) {
  failures.push('item_limit: 0 should set summaryOnly: true')
}

// Default (no params) — itemCount always present
const defaultBoard = await mj.github.getKanbanBoard({ workspace_id: "test-ws" })
if (defaultBoard.columns) {
  for (const col of defaultBoard.columns) {
    if (typeof col.itemCount !== 'number')
      failures.push(`default: column "${col.name}" missing itemCount`)
  }
}

return {
  failures,
  success: failures.length === 0,
  summaryColumnsChecked: summary.columns?.length ?? 0,
  limitedColumnsChecked: limited.columns?.length ?? 0,
}
```

| Check                   | Expected           |
| ----------------------- | ------------------ |
| `success`               | `true`             |
| `failures`              | `[]` (empty array) |
| `summaryColumnsChecked` | ≥ 1                |
| `limitedColumnsChecked` | ≥ 1                |

### 30.2 Body Truncation

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const failures = []

// Get a known issue for testing
const issues = await mj.github.getGithubIssues({ state: 'all', limit: 3 })
const issueNum = issues.issues?.[0]?.number
if (!issueNum)
  return { success: false, error: 'No issues found for testing', failures: ['no_issues'] }

// Default truncation (800 chars)
const defaultIssue = await mj.github.getGithubIssue({ issue_number: issueNum })
if (defaultIssue.issue) {
  if (
    defaultIssue.issue.bodyTruncated === undefined &&
    defaultIssue.issue.bodyFullLength === undefined
  ) {
    // Only valid if body is null or ≤ 800
    const body = defaultIssue.issue.body
    if (body && body.length > 800) failures.push('default: body > 800 but no truncation metadata')
  }
}

// Full body mode (truncate_body: 0)
const fullIssue = await mj.github.getGithubIssue({ issue_number: issueNum, truncate_body: 0 })
if (fullIssue.issue && fullIssue.issue.bodyTruncated === true) {
  failures.push('fullBody: bodyTruncated should be false when truncate_body: 0')
}

// Include comments
const withComments = await mj.github.getGithubIssue({
  issue_number: issueNum,
  include_comments: true,
})
if (withComments.issue) {
  if (!Array.isArray(withComments.comments) && withComments.commentCount === undefined) {
    failures.push('includeComments: no comments array or commentCount present')
  }
}

// Without comments (default)
const noComments = await mj.github.getGithubIssue({ issue_number: issueNum })
if (noComments.comments && Array.isArray(noComments.comments)) {
  failures.push('default: comments should not be present when include_comments is false/absent')
}

// PR truncation
const prs = await mj.github.getGithubPrs({ state: 'all', limit: 3 })
const prNum = prs.pullRequests?.[0]?.number
let prChecked = false
if (prNum) {
  const defaultPr = await mj.github.getGithubPr({ pr_number: prNum })
  prChecked = true
  // Just verify no crash — PR truncation metadata presence depends on body length
}

return {
  failures,
  success: failures.length === 0,
  issueNumTested: issueNum,
  prNumTested: prNum ?? null,
  prChecked,
}
```

| Check       | Expected           |
| ----------- | ------------------ |
| `success`   | `true`             |
| `failures`  | `[]` (empty array) |
| `prChecked` | `true`             |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- See part 2 for remaining success criteria.
