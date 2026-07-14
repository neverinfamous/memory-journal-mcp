# Re-Test memory-journal-mcp — Payload Optimization

**Scope:** Cross-cutting verification of all 4 payload optimization features — Kanban throttling, body truncation, MAX_QUERY_LIMIT enforcement (with cursor keyset pagination), and Code Mode result cap.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## 16.3 MAX_QUERY_LIMIT & Cursor Pagination

> [!NOTE]
> `MAX_QUERY_LIMIT` is 500 — enforced on `get_recent_entries`, `get_github_issues`, `get_github_prs`, `search_entries`, and `search_by_date_range`. Core and Team search tools also support O(1) keyset pagination via the `cursor` parameter and `nextCursor` output.

| #   | Test                | Command                                                        | Expected Result                 |
| --- | ------------------- | -------------------------------------------------------------- | ------------------------------- |
| 14  | Under limit         | `get_recent_entries(workspace_id: "test-ws", limit: 100)`            | Accepted, returns ≤ 100 entries |
| 15  | At limit            | `get_recent_entries(workspace_id: "test-ws", limit: 500)`            | Accepted, returns ≤ 500 entries |
| 16  | Over limit (core)   | `get_recent_entries(workspace_id: "test-ws", limit: 501)`            | Structured validation error     |
| 17  | Over limit (issues) | `get_github_issues(limit: 501)`                                | Structured validation error     |
| 18  | Over limit (PRs)    | `get_github_prs(limit: 501)`                                   | Structured validation error     |
| 19  | Over limit (search) | `search_entries(workspace_id: "test-ws", query: "test", limit: 501)` | Structured validation error     |
| 20  | Cursor keyset (1)   | `get_recent_entries(workspace_id: "test-ws", limit: 1)`              | Returns 1 entry and a `nextCursor` string |
| 21  | Cursor keyset (2)   | `get_recent_entries(workspace_id: "test-ws", limit: 1, cursor: "<next_cursor_from_test_20>")` | Returns distinct next entry and a new `nextCursor` |

### Verification Checks

- `limit: 500` accepted across all paginated tools
- `limit: 501` returns `{success: false, error: "..."}` with validation message — not a raw `-32602`
- The error message references the limit or max value
- Keyset cursor pagination successfully traverses distinct entries (no duplicates across pages)
- `nextCursor` is present when results are returned

---

