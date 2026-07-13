# Re-Test memory-journal-mcp — Code Mode: Payload Optimization

Test all 4 payload optimization features via Code Mode: Kanban throttling (`summary_only`, `item_limit`), body truncation (`truncate_body`, `include_comments`), `MAX_QUERY_LIMIT` enforcement (with keyset cursors), and Code Mode result size cap.

**Scope:** 1 tool (`mj_execute_code`), Phase 30 (Part 2) — ~4 test scripts covering all payload optimization features via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun .\\.agents\\scripts\\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 30: Payload Optimization via Code Mode

### 30.3 MAX_QUERY_LIMIT & Cursor Pagination

```javascript
// Test code (Execute with mj_execute_code):
const failures = []

// At limit — should accept
const atLimit = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 500 })
if (atLimit.success === false) failures.push('limit 500 rejected: ' + atLimit.error)

// Over limit — should reject
const overLimit = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 501 })
if (overLimit.success !== false) failures.push('limit 501 should be rejected')

// GitHub issues over limit
const issuesOver = await mj.github.getGithubIssues({ limit: 501 })
if (issuesOver.success !== false) failures.push('github issues limit 501 should be rejected')

// GitHub PRs over limit
const prsOver = await mj.github.getGithubPrs({ limit: 501 })
if (prsOver.success !== false) failures.push('github PRs limit 501 should be rejected')

// Search over limit
const searchOver = await mj.search.searchEntries({ workspace_id: "test-ws", query: 'test', limit: 501 })
if (searchOver.success !== false) failures.push('search limit 501 should be rejected')

// Test cursor pagination
const cursorPage1 = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 1 })
if (!cursorPage1.next_cursor) failures.push('cursorPage1 missing next_cursor')

if (cursorPage1.next_cursor) {
  const cursorPage2 = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 1, cursor: cursorPage1.next_cursor })
  if (cursorPage1.entries[0]?.id === cursorPage2.entries?.[0]?.id) {
    failures.push('cursor pagination returned identical first item')
  }
}

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

| Check           | Expected                |
| --------------- | ----------------------- |
| Result returned | Object with `msg` field |

**Test 30.4b — Oversized result (over cap):**

```javascript
// Test code (Execute with mj_execute_code):
return 'x'.repeat(120 * 1024)
```

| Check     | Expected                               |
| --------- | -------------------------------------- |
| `success` | `false`                                |
| `error`   | Contains "KB" and "aggregate" guidance |

**Test 30.4c — Boundary result (~50KB, under cap):**

```javascript
// Test code (Execute with mj_execute_code):
return 'z'.repeat(50 * 1024)
```

| Check           | Expected                         |
| --------------- | -------------------------------- |
| Result returned | 50KB string passes without error |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Kanban `summary_only` returns zero items per column with `itemCount` metadata
- Kanban `item_limit` truncates columns and sets `truncated: true`
- Zero `item_limit` behaves identically to `summary_only: true`
- Body truncation defaults to 800 chars with `bodyTruncated`/`bodyFullLength` metadata
- `include_comments: true` returns `comments` array and `commentCount`
- `MAX_QUERY_LIMIT` (500) enforced — `limit: 501` produces structured errors on core, github, and search tools
- O(1) keyset cursor pagination successfully traverses distinct entries and returns `next_cursor`
- Code Mode 100KB cap produces structured error with "aggregate" guidance and KB sizes
- Results under 100KB pass through without error
- All test scripts return `{ success: true, failures: [] }`
- Agent reports the Total Token Estimate in the final summary
