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

## 16.4 Code Mode Result Cap

> [!NOTE]
> The default Code Mode result size cap is 100KB (configurable via `CODE_MODE_MAX_RESULT_SIZE` env var or `--codemode-max-result-size` CLI flag). Oversized results return structured errors with agent-guidance messaging.

| #   | Test               | Command                                                  | Expected Result                                                 |
| --- | ------------------ | -------------------------------------------------------- | --------------------------------------------------------------- |
| 20  | Small result       | `mj_execute_code(code: "return { msg: 'ok' }")`          | Result returned normally                                        |
| 21  | Under cap (~50KB)  | `mj_execute_code(code: "return 'z'.repeat(50 * 1024)")`  | Result returned normally                                        |
| 22  | Oversized (~120KB) | `mj_execute_code(code: "return 'x'.repeat(120 * 1024)")` | `{success: false, error: "..."}` with KB sizes in error message |
| 23  | Guidance message   | Inspect error from test #22                              | Error contains "aggregate" guidance and actual/limit KB values  |

### Verification Checks

- Results under 100KB pass through without error
- Results over 100KB produce structured error (not a crash or raw exception)
- Error message includes actual size in KB, limit in KB, and aggregation guidance example

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Kanban `summary_only` returns zero items per column with `itemCount` metadata
- Kanban `item_limit: 101` is rejected by validation
- Body truncation defaults to 800 chars with metadata flags
- `include_comments: true` returns comment data
- `MAX_QUERY_LIMIT` (500) enforced on core, github, and search tools
- O(1) keyset cursor pagination correctly returns `nextCursor` and allows distinct forward traversal
- Code Mode 100KB cap produces agent-guidance error with KB values
- No raw `-32602` errors from any new parameter
- Agent reports the Total Token Estimate in the final summary
