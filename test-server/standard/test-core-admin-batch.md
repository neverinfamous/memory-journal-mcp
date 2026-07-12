# Re-Test memory-journal-mcp — Admin Batch Operations

**Scope:** Tag management, entry export, and backup/restore operations.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---


### 5.3 Batch Operations

| Test                  | Command/Action                                              | Expected Result                                                                  |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Batch Create          | `batch_create_entries(entries: [{ project_number: 5, content: "B1" }, { project_number: 5, content: "B2" }])` | Array of two entry IDs returned |
| Batch Create Limit    | `batch_create_entries(entries: [51 items])`                 | Structured error: `{ success: false, error: "..." }` exceeding 50 limit          |
| Batch Create No Project | `batch_create_entries(entries: [{ content: "No project" }])` | `{ success: false }` with structured error: "Missing project_number..." |
| Batch Update          | `batch_update_entries(updates: [{ entry_id: <id1>, content: "U1" }, { entry_id: <id2>, content: "U2" }])` | `success: true` and array of IDs       |
| Batch Delete          | `batch_delete_entries(entry_ids: [<id1>, <id2>])`           | `success: true` and count of deleted entries                                     |
| Run Auto Prune        | `run_auto_prune(project_number: 5)`                         | `success: true` and count of pruned (hard-deleted) entries                       |

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