# Re-Test memory-journal-mcp — Search Tool Group

**Scope:** Deterministic verification of the Search tool group (`cross_team_search`, `get_vector_index_stats`, `list_deleted_entries`, `search_by_date_range`, `search_entries`, `semantic_search`) against the strict error handling matrix.

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

| Tool                   | Happy Path             | Domain Error Test                                                       | Zod Empty Param (`{}`)            | Zod Type Mismatch                             |
| ---------------------- | ---------------------- | ----------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| `search_entries`       | Search by valid string | N/A                                                                     | ⚠️ Should return validation error | `limit: "abc", fts_weight: "abc", include_highlights: "abc"`  |
| `search_by_date_range` | Search valid range     | `start_date: "2026-12-31", end_date: "2026-01-01"` (inverted)           | ⚠️ Should return validation error | `start_date: "Jan 1"`                         |
| `semantic_search`      | Search by meaning      | Vector manager unavailable (returns `{ success: false, error: "..." }`) | ⚠️ Should return validation error | `limit: "abc"`, `similarity_threshold: "abc"` |
| `list_deleted_entries` | List soft-deleted      | N/A                                                                     | Should succeed (defaults)         | `limit: "abc"`                                |
| `cross_team_search`    | Search multiple DBs    | Database missing (degrades gracefully with error in output)             | ⚠️ Should return validation error | `team_dbs: "abc", limit: "abc"`               |
| `get_vector_index_stats` | Fetch index stats    | N/A                                                                     | Should succeed (defaults)         | N/A                                           |

## 2. Integrity & Boundary Testing

| Test                  | Action                                                                    | Verification                                                                       |
| --------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Soft Delete Isolation | Search after deleting entry                                               | Verify deleted entry does not appear in search results or semantic search results. |
| Filter Ignored Bug    | `search_by_date_range` with `issue_number: 44`                            | ⚠️ Verify if issue filter applies (should not silently ignore).                    |
| Filter Ignored Bug    | `search_by_date_range` with `workflow_run_id: 999`                        | ⚠️ Verify if filter applies.                                                       |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Agent reports the Total Token Estimate in the final summary (using the `memory://metrics/tokens` and `memory://metrics/summary` server resources, DO NOT use scripts to parse filesystem responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Zod boundary limits prevent crashes.
- Invalid dates return structured Domain/Validation errors.
- No raw `-32602` responses.
- Invalid `sort_by` value returns structured Zod validation error.
- Valid `sort_by: 'importance'` returns entries with `importanceScore` field sorted descending.
