# Test memory-journal-mcp — Payload Optimization

**Scope:** Cross-cutting verification of all 4 payload optimization features — Kanban throttling, body truncation, MAX_QUERY_LIMIT enforcement, and Code Mode result cap.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected. Use https://github.com/users/neverinfamous/projects/5 for Kanban testing.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. **USER** verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## 16.1 Kanban Throttling (`get_kanban_board`)

> [!NOTE]
> `get_kanban_board` accepts two new payload optimization parameters: `summary_only` (boolean) and `item_limit` (number, default 25, max 100). When `summary_only: true`, items are stripped and only column-level `itemCount` metadata is returned.

| #  | Test                 | Command                                                                    | Expected Result                                                                                      |
| -- | -------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1  | Summary mode         | `get_kanban_board(project_number: 5, summary_only: true)`                  | `summaryOnly: true`, all columns have `items: []`, each column has `itemCount ≥ 0`                   |
| 2  | Item limit           | `get_kanban_board(project_number: 5, item_limit: 2)`                       | Columns with >2 items show `truncated: true`, `items.length ≤ 2`, `itemCount` shows full count       |
| 3  | Zero limit = summary | `get_kanban_board(project_number: 5, item_limit: 0)`                       | Same behavior as `summary_only: true` — empty items, `summaryOnly: true`                             |
| 4  | Default throttling   | `get_kanban_board(project_number: 5)`                                      | Default `item_limit: 25` applied. `itemCount` present on all columns                                 |
| 5  | Over-limit rejected  | `get_kanban_board(project_number: 5, item_limit: 101)`                     | Structured validation error (max 100)                                                                |
| 6  | Combined params      | `get_kanban_board(project_number: 5, summary_only: false, item_limit: 5)`  | `summaryOnly` is `false` or absent, items present but capped at 5 per column                         |

### Verification Checks

- [ ] `summaryOnly` flag is `true` in response for tests #1 and #3
- [ ] `itemCount` is a number on every column in all responses
- [ ] `truncated: true` appears on columns where total items exceed `item_limit`
- [ ] `item_limit: 101` produces a structured validation error, not a raw `-32602`

---

## 16.2 Body Truncation (`get_github_issue`, `get_github_pr`)

> [!NOTE]
> `get_github_issue` accepts `truncate_body` (number, default 800, 0 = full body) and `include_comments` (boolean, default false). `get_github_pr` accepts `truncate_body`. When bodies are truncated, `bodyTruncated: true` and `bodyFullLength` metadata are included in the response.

| #  | Test                   | Command                                                              | Expected Result                                                                     |
| -- | ---------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 7  | Default truncation     | `get_github_issue(issue_number: <N>)`                                | `body` ≤ 800 chars if original was longer, `bodyTruncated` flag present             |
| 8  | Full body              | `get_github_issue(issue_number: <N>, truncate_body: 0)`              | Full body returned, `bodyTruncated: false`                                          |
| 9  | Custom truncation      | `get_github_issue(issue_number: <N>, truncate_body: 100)`            | Body ≤ 100 chars if original was longer, `bodyFullLength` shows original length     |
| 10 | Include comments       | `get_github_issue(issue_number: <N>, include_comments: true)`        | `comments` array present in response, `commentCount` matches array length           |
| 11 | Default no comments    | `get_github_issue(issue_number: <N>)`                                | No `comments` array in response (or `comments` absent)                              |
| 12 | PR default truncation  | `get_github_pr(pr_number: <N>)`                                      | `bodyTruncated` flag present on the PR response                                     |
| 13 | PR full body           | `get_github_pr(pr_number: <N>, truncate_body: 0)`                    | Full body returned, `bodyTruncated: false`                                          |

### Verification Checks

- [ ] Default `truncate_body: 800` applied without explicit param
- [ ] `truncate_body: 0` disables truncation — full body returned
- [ ] `bodyTruncated` and `bodyFullLength` metadata present when truncation occurs
- [ ] `include_comments: true` returns `comments` array and `commentCount`
- [ ] PR truncation mirrors issue behavior

---

## 16.3 MAX_QUERY_LIMIT (Pagination Cap)

> [!NOTE]
> `MAX_QUERY_LIMIT` is 500 — enforced on `get_recent_entries`, `get_github_issues`, `get_github_prs`, `search_entries`, and `search_by_date_range`.

| #  | Test                   | Command                                 | Expected Result                      |
| -- | ---------------------- | --------------------------------------- | ------------------------------------ |
| 14 | Under limit            | `get_recent_entries(limit: 100)`        | Accepted, returns ≤ 100 entries      |
| 15 | At limit               | `get_recent_entries(limit: 500)`        | Accepted, returns ≤ 500 entries      |
| 16 | Over limit (core)      | `get_recent_entries(limit: 501)`        | Structured validation error          |
| 17 | Over limit (issues)    | `get_github_issues(limit: 501)`         | Structured validation error          |
| 18 | Over limit (PRs)       | `get_github_prs(limit: 501)`            | Structured validation error          |
| 19 | Over limit (search)    | `search_entries(query: "test", limit: 501)` | Structured validation error      |

### Verification Checks

- [ ] `limit: 500` accepted across all paginated tools
- [ ] `limit: 501` returns `{success: false, error: "..."}` with validation message — not a raw `-32602`
- [ ] The error message references the limit or max value

---

## 16.4 Code Mode Result Cap

> [!NOTE]
> The default Code Mode result size cap is 100KB (configurable via `CODE_MODE_MAX_RESULT_SIZE` env var or `--codemode-max-result-size` CLI flag). Oversized results return structured errors with agent-guidance messaging.

| #  | Test               | Command                                                          | Expected Result                                                   |
| -- | ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| 20 | Small result       | `mj_execute_code(code: "return { msg: 'ok' }")`                 | Result returned normally                                          |
| 21 | Under cap (~50KB)  | `mj_execute_code(code: "return 'z'.repeat(50 * 1024)")`         | Result returned normally                                          |
| 22 | Oversized (~120KB) | `mj_execute_code(code: "return 'x'.repeat(120 * 1024)")`        | `{success: false, error: "..."}` with KB sizes in error message   |
| 23 | Guidance message   | Inspect error from test #22                                      | Error contains "aggregate" guidance and actual/limit KB values    |

### Verification Checks

- [ ] Results under 100KB pass through without error
- [ ] Results over 100KB produce structured error (not a crash or raw exception)
- [ ] Error message includes actual size in KB, limit in KB, and aggregation guidance example

---

## Success Criteria

- [ ] Kanban `summary_only` returns zero items per column with `itemCount` metadata
- [ ] Kanban `item_limit: 101` is rejected by validation
- [ ] Body truncation defaults to 800 chars with metadata flags
- [ ] `include_comments: true` returns comment data
- [ ] `MAX_QUERY_LIMIT` (500) enforced on core, github, and search tools
- [ ] Code Mode 100KB cap produces agent-guidance error with KB values
- [ ] No raw `-32602` errors from any new parameter
- [ ] Agent reports the Total Token Estimate in the final summary
