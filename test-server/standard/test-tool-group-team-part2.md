# Re-Test memory-journal-mcp — Team Tool Group

**Scope:** Deterministic verification of Team tools (`team_create_entry`, `team_search`, `team_update_entry`, `team_batch_create_entries`, etc.) against strict error handling constraints.

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

## 1. Zod Boundary & Type Mismatch Matrix

> **Note:** Type mismatch leakage (e.g., `-32602` raw MCP errors instead of structured `VALIDATION_ERROR`) is now automatically tested in CI via `test-server/scripts/test-team-zod.mjs`.

| Tool                                           | Domain Error Test                                    | Zod Empty Param (`{}`)            | Zod Type Mismatch |
| ---------------------------------------------- | ---------------------------------------------------- | --------------------------------- | ----------------- |
| All Team Tools                                 | Team DB not configured -> Returns `{success: false}` | N/A                               | N/A               |
| `team_batch_create_entries`                    | `entries: []`                                        | ⚠️ Should return validation error | `entries: "abc"`  |
| `team_batch_update_entries`                    | `updates: []`                                        | ⚠️ Should return validation error | `updates: "abc"`  |
| `team_batch_delete_entries`                    | `entry_ids: []`                                      | ⚠️ Should return validation error | `entry_ids: "abc"`|
| `team_get_statistics`                          | N/A                                                  | Should succeed (defaults)         | `start_date: 123` |
| `team_link_entries`                            | `from_entry_id: 999999`                              | ⚠️ Should return validation error | `from_entry_id: "abc"` |
| `team_visualize_relationships`                 | `entry_id: 999999`                                   | ⚠️ Should return validation error | `entry_id: "abc"` |
| `team_export_entries`                          | N/A                                                  | Should succeed (defaults)         | `limit: "abc"`    |
| `team_export_markdown`                         | `output_dir: "../../etc"`                            | ⚠️ Should return validation error | `limit: "abc"`    |
| `team_import_markdown`                         | `source_dir: "../../etc"`                            | ⚠️ Should return validation error | `dry_run: "abc"`  |
| `team_import_external`                         | `source_dir: "../../etc"`                            | ⚠️ Should return validation error | `source_format: 123` |
| `team_backup`                                  | `name: "../../etc"`                                  | Should succeed (defaults)         | `name: 123`       |
| `team_list_backups`                            | N/A                                                  | Should succeed (defaults)         | N/A               |
| `team_semantic_search`                         | Vector manager unavailable                           | ⚠️ Should return validation error | `limit: "abc"`    |
| `team_get_vector_index_stats`                  | N/A                                                  | Should succeed (defaults)         | N/A               |
| `team_rebuild_vector_index`                    | N/A                                                  | Should succeed (defaults)         | N/A               |
| `team_add_to_vector_index`                     | `entry_id: 999999`                                   | ⚠️ Should return validation error | `entry_id: "abc"` |

### Specific Domain Checks

- **Unavailable Team Vector**: Use `team_semantic_search(project_number: 5)` without vector initialization -> verify structured JSON error.
- **Team Insights**: Verify `team_get_cross_project_insights` returns the requisite fields even when the query returns absolutely zero rows.
- **Update Project Omission**: Verify that `team_update_entry` successfully updates an entry when `project_number` is omitted by falling back to its existing project number.


## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Team Database missing context natively halts and warns user without crashing the MCP worker.
- Missing models do not crash vector fallback pipelines.
