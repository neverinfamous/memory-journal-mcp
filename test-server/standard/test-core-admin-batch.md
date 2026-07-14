# Re-Test memory-journal-mcp — Admin Batch Operations

**Scope:** Tag management, entry export, and backup/restore operations.

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


### 5.3 Batch Operations

| Test                  | Command/Action                                              | Expected Result                                                                  |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Batch Create          | `batch_create_entries(entries: [{ workspace_id: "test-ws", content: "B1" }, { workspace_id: "test-ws", content: "B2" }])` | Array of two entry IDs returned |
| Batch Create Limit    | `batch_create_entries(entries: [51 items])`                 | Structured error: `{ success: false, error: "..." }` exceeding 50 limit          |
| Batch Create No Project | `batch_create_entries(entries: [{ content: "No project" }])` | `{ success: false }` with structured error: "Missing workspace_id..." |
| Batch Update          | `batch_update_entries(updates: [{ id: <id1>, content: "U1" }, { id: <id2>, content: "U2" }])` | `success: true` and array of IDs       |
| Batch Delete          | `batch_delete_entries(entry_ids: [<id1>, <id2>])`           | `success: true` and count of deleted entries                                     |
| Run Auto Prune        | `run_auto_prune(workspace_id: "test-ws")`                         | `success: true` and count of pruned (hard-deleted) entries                       |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `merge_tags` consolidates duplicate tags correctly — verified via `list_tags` and entry re-check
- `merge_tags` returns structured error when source equals target or source tag nonexistent
- `backup_journal` rejects names containing path traversal characters (`../`) with structured errors
- `restore_backup` with nonexistent filename returns structured error
- `batch_create_entries` enforces max 50 limit with structured error
- `batch_delete_entries` soft-deletes multiple entries atomically
- `search_audit_log` successfully returns filtered audit logs
- `update_configuration` successfully modifies runtime config and returns `updated` keys