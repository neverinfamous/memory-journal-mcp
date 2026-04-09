# Test memory-journal-mcp — Code Mode: Payload Optimization

Test all 4 payload optimization features via Code Mode: Kanban throttling (`summary_only`, `item_limit`), body truncation (`truncate_body`, `include_comments`), `MAX_QUERY_LIMIT` enforcement, and Code Mode result size cap.

**Scope:** 1 tool (`mj_execute_code`), Phase 30 — ~4 test scripts covering all payload optimization features via Code Mode.

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
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

---

## Phase 30: Payload Optimization via Code Mode

### 30.1 Kanban Throttling

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const failures = []

// Summary mode: items should be empty, itemCount present
const summary = await mj.github.getKanbanBoard({ project_number: 5, summary_only: true })
if (summary.columns) {
  if (!summary.summaryOnly) failures.push('summaryOnly flag not set')
  for (const col of summary.columns) {
    if (col.items?.length > 0) failures.push(`summaryMode: column "${col.name}" has ${col.items.length} items, expected 0`)
    if (typeof col.itemCount !== 'number') failures.push(`summaryMode: column "${col.name}" missing itemCount`)
  }
} else if (summary.success !== false) {
  failures.push('summary mode returned no columns and no error')
}

// Item limit: truncated flag on columns exceeding limit
const limited = await mj.github.getKanbanBoard({ project_number: 5, item_limit: 2 })
if (limited.columns) {
  for (const col of limited.columns) {
    if (col.items?.length > 2) failures.push(`itemLimit: column "${col.name}" has ${col.items.length} items, expected ≤2`)
    if (typeof col.itemCount !== 'number') failures.push(`itemLimit: column "${col.name}" missing itemCount`)
    if (col.itemCount > 2 && col.truncated !== true) failures.push(`itemLimit: column "${col.name}" should be truncated`)
  }
}

// Zero limit = summary mode
const zeroLimit = await mj.github.getKanbanBoard({ project_number: 5, item_limit: 0 })
if (zeroLimit.columns && !zeroLimit.summaryOnly) {
  failures.push('item_limit: 0 should set summaryOnly: true')
}

// Default (no params) — itemCount always present
const defaultBoard = await mj.github.getKanbanBoard({ project_number: 5 })
if (defaultBoard.columns) {
  for (const col of defaultBoard.columns) {
    if (typeof col.itemCount !== 'number') failures.push(`default: column "${col.name}" missing itemCount`)
  }
}

return {
  failures,
  success: failures.length === 0,
  summaryColumnsChecked: summary.columns?.length ?? 0,
  limitedColumnsChecked: limited.columns?.length ?? 0,
}
```

| Check                       | Expected                |
| --------------------------- | ----------------------- |
| `success`                   | `true`                  |
| `failures`                  | `[]` (empty array)      |
| `summaryColumnsChecked`     | ≥ 1                     |
| `limitedColumnsChecked`     | ≥ 1                     |

### 30.2 Body Truncation

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const failures = []

// Get a known issue for testing
const issues = await mj.github.getGithubIssues({ limit: 3 })
const issueNum = issues.issues?.[0]?.number
if (!issueNum) return { success: false, error: 'No issues found for testing', failures: ['no_issues'] }

// Default truncation (800 chars)
const defaultIssue = await mj.github.getGithubIssue({ issue_number: issueNum })
if (defaultIssue.issue) {
  if (defaultIssue.issue.bodyTruncated === undefined && defaultIssue.issue.bodyFullLength === undefined) {
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
const withComments = await mj.github.getGithubIssue({ issue_number: issueNum, include_comments: true })
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
const prs = await mj.github.getGithubPrs({ limit: 3 })
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

| Check          | Expected           |
| -------------- | ------------------ |
| `success`      | `true`             |
| `failures`     | `[]` (empty array) |
| `prChecked`    | `true`             |

### 30.3 MAX_QUERY_LIMIT

```javascript
// Test code (Execute with mj_execute_code):
const failures = []

// At limit — should accept
const atLimit = await mj.core.getRecentEntries({ limit: 500 })
if (atLimit.success === false) failures.push('limit 500 rejected: ' + atLimit.error)

// Over limit — should reject
const overLimit = await mj.core.getRecentEntries({ limit: 501 })
if (overLimit.success !== false) failures.push('limit 501 should be rejected')

// GitHub issues over limit
const issuesOver = await mj.github.getGithubIssues({ limit: 501 })
if (issuesOver.success !== false) failures.push('github issues limit 501 should be rejected')

// GitHub PRs over limit
const prsOver = await mj.github.getGithubPrs({ limit: 501 })
if (prsOver.success !== false) failures.push('github PRs limit 501 should be rejected')

// Search over limit
const searchOver = await mj.search.searchEntries({ query: 'test', limit: 501 })
if (searchOver.success !== false) failures.push('search limit 501 should be rejected')

return {
  failures,
  success: failures.length === 0,
  atLimitCount: atLimit.count ?? atLimit.entries?.length ?? 0,
}
```

| Check          | Expected           |
| -------------- | ------------------ |
| `success`      | `true`             |
| `failures`     | `[]` (empty array) |
| `atLimitCount` | ≥ 0                |

### 30.4 Result Size Cap

> [!CAUTION]
> These tests deliberately generate oversized payloads. The Code Mode sandbox enforces a 100KB result cap (configurable via `CODE_MODE_MAX_RESULT_SIZE`).

**Test 30.4a — Small result (under cap):**

```javascript
// Test code (Execute with mj_execute_code):
return { msg: 'small result', timestamp: Date.now() }
```

| Check | Expected |
| ----- | -------- |
| Result returned | Object with `msg` field |

**Test 30.4b — Oversized result (over cap):**

```javascript
// Test code (Execute with mj_execute_code):
return 'x'.repeat(120 * 1024)
```

| Check | Expected |
| ----- | -------- |
| `success` | `false` |
| `error` | Contains "KB" and "aggregate" guidance |

**Test 30.4c — Boundary result (~50KB, under cap):**

```javascript
// Test code (Execute with mj_execute_code):
return 'z'.repeat(50 * 1024)
```

| Check | Expected |
| ----- | -------- |
| Result returned | 50KB string passes without error |

---

## Success Criteria

- [ ] Kanban `summary_only` returns zero items per column with `itemCount` metadata
- [ ] Kanban `item_limit` truncates columns and sets `truncated: true`
- [ ] Zero `item_limit` behaves identically to `summary_only: true`
- [ ] Body truncation defaults to 800 chars with `bodyTruncated`/`bodyFullLength` metadata
- [ ] `include_comments: true` returns `comments` array and `commentCount`
- [ ] `MAX_QUERY_LIMIT` (500) enforced — `limit: 501` produces structured errors on core, github, and search tools
- [ ] Code Mode 100KB cap produces structured error with "aggregate" guidance and KB sizes
- [ ] Results under 100KB pass through without error
- [ ] All test scripts return `{ success: true, failures: [] }`
- [ ] Agent reports the Total Token Estimate in the final summary
