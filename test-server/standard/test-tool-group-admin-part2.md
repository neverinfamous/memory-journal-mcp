# Re-Test memory-journal-mcp — Admin Tool Group

**Scope:** Deterministic verification of Admin operations (`update_entry`, `delete_entry`, `restore_entry`, `batch_create_entries`, `batch_update_entries`, `batch_delete_entries`, `rebuild_vector_index`, `add_to_vector_index`, `merge_tags`, `search_audit_log`, `run_auto_prune`, `update_configuration`) against strict error handling constraints.

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

## 1. Zod Boundary & Type Mismatch Matrix

| Tool                  | Happy Path       | Domain Error Test                              | Zod Empty Param (`{}`)            | Zod Type Mismatch |
| --------------------- | ---------------- | ---------------------------------------------- | --------------------------------- | ----------------- |
| `merge_tags`          | Merge valid tags | `source_tag: "nonexistent", target_tag: "abc"` | ⚠️ Should return validation error | `source_tag: 123` |
| `add_to_vector_index` | Add valid        | `entry_id: 999999`                             | ⚠️ Should return validation error | `entry_id: "abc"` |
| `update_configuration` | Auto-injected missing test | ⚠️ Should return validation error | `param: "abc"` |
| `update_entry` | Auto-injected missing test | ⚠️ Should return validation error | `param: "abc"` |
| `update_project` | Auto-injected missing test | ⚠️ Should return validation error | `param: "abc"` |


### Specific Domain Checks

- **Same-Tag Merging**: Ensure `merge_tags` where `source_tag` == `target_tag` returns a structured error.
- **Unavailable Vector**: Triggering `add_to_vector_index` without an initialized vector db should gracefully reject with `{success: false}`.

## 2. Integrity & Boundary Testing

| Test                  | Action         | Verification                                                            |
| --------------------- | -------------- | ----------------------------------------------------------------------- |
| Merge Integrity       | `merge_tags`   | Ensure source tag is deleted and target tag count equals original sums. |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- Administrative mutations correctly block non-existent targets.
- Vector integrations fallback safely without MCP crashes.
