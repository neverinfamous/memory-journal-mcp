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

## 16.1 Kanban Throttling (`get_kanban_board`)

> [!NOTE]
> `get_kanban_board` accepts two new payload optimization parameters: `summary_only` (boolean) and `item_limit` (number, default 25, max 100). When `summary_only: true`, items are stripped and only column-level `itemCount` metadata is returned.

| #   | Test                 | Command                                                                   | Expected Result                                                                                |
| --- | -------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Summary mode         | `get_kanban_board(workspace_id: "test-ws", summary_only: true)`                 | `summaryOnly: true`, all columns have `items: []`, each column has `itemCount ≥ 0`             |
| 2   | Item limit           | `get_kanban_board(workspace_id: "test-ws", item_limit: 2)`                      | Columns with >2 items show `truncated: true`, `items.length ≤ 2`, `itemCount` shows full count |
| 3   | Zero limit = summary | `get_kanban_board(workspace_id: "test-ws", item_limit: 0)`                      | Same behavior as `summary_only: true` — empty items, `summaryOnly: true`                       |
| 4   | Default throttling   | `get_kanban_board(workspace_id: "test-ws")`                                     | Default `item_limit: 25` applied. `itemCount` present on all columns                           |
| 5   | Over-limit rejected  | `get_kanban_board(workspace_id: "test-ws", item_limit: 101)`                    | Structured validation error (max 100)                                                          |
| 6   | Combined params      | `get_kanban_board(workspace_id: "test-ws", summary_only: false, item_limit: 5)` | `summaryOnly` is `false` or absent, items present but capped at 5 per column                   |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `summaryOnly` flag is `true` in response for tests #1 and #3
- `itemCount` is a number on every column in all responses
- `truncated: true` appears on columns where total items exceed `item_limit`
- `item_limit: 101` produces a structured validation error, not a raw `-32602`

---

