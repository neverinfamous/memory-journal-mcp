# Re-Test memory-journal-mcp — Backup Tool Group

**Scope:** Deterministic verification of Backup tools (`backup_journal`, `list_backups`, `restore_backup`, `cleanup_backups`) against the strict error handling constraints.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## 1. Zod Boundary & Type Mismatch Matrix

| Tool              | Domain Error Test                           | Zod Empty Param (`{}`)       | Zod Type Mismatch   |
| ----------------- | ------------------------------------------- | ---------------------------- | ------------------- |
| `restore_backup`  | `filename: "nonexistent.db"`                | ⚠️ Validation error required | N/A                 |
| `backup_journal`  | `name: "../../etc/passwd"` (Path traversal) | Success (Timestamp default)  | N/A                 |
| `list_backups`    | N/A                                         | N/A                          | N/A                 |
| `cleanup_backups` | N/A                                         | N/A                          | `keep_count: "abc"` |

### Specific Domain Checks

- **Cleanup Count Limitation**: `cleanup_backups(keep_count: 0)`. Verify structural error block due to Zod min limit (should be min 1).

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- Restricting malicious or absent file paths in Backup tools.
- Filter boundaries strictly enforced without silent omissions.
