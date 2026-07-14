# Re-Test memory-journal-mcp — IO Tool Group

**Scope:** Deterministic verification of the IO tool group (`export_entries`, `export_markdown`) against the strict error handling matrix.

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

## 1. Zod Boundary & Type Mismatch Matrix

| Tool                   | Happy Path         | Domain Error Test                                                       | Zod Empty Param (`{}`)            | Zod Type Mismatch             |
| ---------------------- | ------------------ | ----------------------------------------------------------------------- | --------------------------------- | ----------------------------- |
| `export_entries`       | Export valid       | N/A                                                                     | Should succeed (defaults)         | `limit: "abc"`                |
| `export_markdown`      | Export valid dir   | `output_dir: "../../etc"` (Path traversal)                              | ⚠️ Should return validation error | `limit: "abc"`                |

### Specific Domain Checks

- **Silent Filter Bug check**: `export_entries(format: "json", tags: ["xyz"], limit: 100)`. If output lacks filter enforcement (returns completely unfiltered rows), mark as ⚠️.
- **Date Ignorance Bug**: `export_entries(fromDate: "2099-01-01")`. Should return 0 results. If results exist, handler is ignoring filters.
- **Path Traversal Defense**: Ensure `export_markdown`, `import_markdown`, and `import_external` correctly reject paths containing `..` or paths outside `ALLOWED_IO_ROOTS`.

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Path traversal correctly triggers Domain/Validation errors.
- Export filters correctly applied.
- Zod bounds correctly enforced.
