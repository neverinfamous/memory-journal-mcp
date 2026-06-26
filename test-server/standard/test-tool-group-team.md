# Re-Test memory-journal-mcp — Team Tool Group

**Scope:** Deterministic verification of Team tools (`team_create_entry(project_number: 5)`, `team_search(project_number: 5)`, `team_update_entry`, `team_batch_create_entries`, etc.) against strict error handling constraints.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas (e.g., Team Tools, Admin Tools).
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- **Required Tool Groups:** `codemode`, `team`
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## 1. Zod Boundary & Type Mismatch Matrix

> **Note:** Type mismatch leakage (e.g., `-32602` raw MCP errors instead of structured `VALIDATION_ERROR`) is now automatically tested in CI via `test-server/scripts/test-team-zod.mjs`.

| Tool                                           | Domain Error Test                                    | Zod Empty Param (`{}`)            | Zod Type Mismatch |
| ---------------------------------------------- | ---------------------------------------------------- | --------------------------------- | ----------------- |
| All Team Tools                                 | Team DB not configured -> Returns `{success: false}` | N/A                               | N/A               |
| `team_create_entry(project_number: 5)`         | `entry_type: "invalid"`                              | ⚠️ Should return validation error | `content: 123`    |
| `team_update_entry(project_number: 5)`         | `entry_id: 999999`                                   | ⚠️ Should return validation error | `entry_id: "abc"` |
| `team_batch_create_entries(project_number: 5)` | `entries: []`                                        | ⚠️ Should return validation error | `entries: "abc"`  |
| `team_batch_update_entries(project_number: 5)` | `updates: []`                                        | ⚠️ Should return validation error | `updates: "abc"`  |
| `team_batch_delete_entries(project_number: 5)` | `entry_ids: []`                                      | ⚠️ Should return validation error | `entry_ids: "abc"`|
| `team_search_by_date_range(project_number: 5)` | `start_date: "Jan 1"`                                | ⚠️ Should return validation error | `limit: "abc"`    |
| `team_merge_tags(project_number: 5)`           | `source_tag: "x"; target_tag: "x"`                   | ⚠️ Should return validation error | N/A               |
| `cross_team_search`                            | `team_dbs: ["invalid"]`                              | ⚠️ Should return validation error | `limit: "abc"`    |

### Specific Domain Checks

- **Unavailable Team Vector**: Use `team_semantic_search(project_number: 5)` without vector initialization -> verify structured JSON error.
- **Team Insights**: Verify `team_get_cross_project_insights` returns the requisite fields even when the query returns absolutely zero rows.
- **Update Project Omission**: Verify that `team_update_entry` successfully updates an entry when `project_number` is omitted by falling back to its existing project number.


## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Team Database missing context natively halts and warns user without crashing the MCP worker.
- Missing models do not crash vector fallback pipelines.
