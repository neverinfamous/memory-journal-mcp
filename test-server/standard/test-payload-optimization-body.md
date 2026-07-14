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
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## 16.2 Body Truncation (`get_github_issue`, `get_github_pr`)

> [!NOTE]
> `get_github_issue` accepts `truncate_body` (number, default 800, 0 = full body) and `include_comments` (boolean, default false). `get_github_pr` accepts `truncate_body`. When bodies are truncated, `bodyTruncated: true` and `bodyFullLength` metadata are included in the response.

| #   | Test                  | Command                                                       | Expected Result                                                                 |
| --- | --------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 7   | Default truncation    | `get_github_issue(issueNumber: <N>)`                         | `body` ≤ 800 chars if original was longer, `bodyTruncated` flag present         |
| 8   | Full body             | `get_github_issue(issueNumber: <N>, truncate_body: 0)`       | Full body returned, `bodyTruncated: false`                                      |
| 9   | Custom truncation     | `get_github_issue(issueNumber: <N>, truncate_body: 100)`     | Body ≤ 100 chars if original was longer, `bodyFullLength` shows original length |
| 10  | Include comments      | `get_github_issue(issueNumber: <N>, include_comments: true)` | `comments` array present in response, `commentCount` matches array length       |
| 11  | Default no comments   | `get_github_issue(issueNumber: <N>)`                         | No `comments` array in response (or `comments` absent)                          |
| 12  | PR default truncation | `get_github_pr(prNumber: <N>)`                               | `bodyTruncated` flag present on the PR response                                 |
| 13  | PR full body          | `get_github_pr(prNumber: <N>, truncate_body: 0)`             | Full body returned, `bodyTruncated: false`                                      |

### Verification Checks

- Default `truncate_body: 800` applied without explicit param
- `truncate_body: 0` disables truncation — full body returned
- `bodyTruncated` and `bodyFullLength` metadata present when truncation occurs
- `include_comments: true` returns `comments` array and `commentCount`
- PR truncation mirrors issue behavior

---

