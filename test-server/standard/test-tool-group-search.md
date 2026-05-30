# Re-Test memory-journal-mcp — Search Tool Group

**Scope:** Deterministic verification of the Search tool group (`search_entries`, `search_by_date_range`, `semantic_search`) against the strict error handling matrix.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## 1. Zod Boundary & Type Mismatch Matrix

| Tool                   | Happy Path             | Domain Error Test                                                       | Zod Empty Param (`{}`)            | Zod Type Mismatch                             |
| ---------------------- | ---------------------- | ----------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| `search_entries`       | Search by valid string | N/A                                                                     | ⚠️ Should return validation error | `limit: "abc"`                                |
| `search_by_date_range` | Search valid range     | `start_date: "2026-12-31", end_date: "2026-01-01"` (inverted)           | ⚠️ Should return validation error | `start_date: "Jan 1"`                         |
| `semantic_search`      | Search by meaning      | Vector manager unavailable (returns `{ success: false, error: "..." }`) | ⚠️ Should return validation error | `limit: "abc"`, `similarity_threshold: "abc"` |

## 2. Integrity & Boundary Testing

| Test                  | Action                                                 | Verification                                                                       |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Maximum Limit         | `search_entries(project_number: 5, ..., limit: 500)`                      | Returns 500 or fewer entries.                                                      |
| Limit Exceeded        | `search_entries(project_number: 5, ..., limit: 501)`                      | Structured validation error.                                                       |
| Threshold Limits      | `semantic_search(..., similarity_threshold: 0.0)`      | Returns all indexed entries.                                                       |
| Threshold Limits      | `semantic_search(..., similarity_threshold: 1.0)`      | Returns exact match or zero entries.                                               |
| Soft Delete Isolation | Search after deleting entry                            | Verify deleted entry does not appear in search results or semantic search results. |
| Filter Ignored Bug    | `search_by_date_range` with `issue_number: 44`         | ⚠️ Verify if issue filter applies (should not silently ignore).                    |
| Filter Ignored Bug    | `search_by_date_range` with `workflow_run_id: 999`     | ⚠️ Verify if filter applies.                                                       |
| Invalid sort_by       | `search_entries(project_number: 5, query: "test", sort_by: "invalid")`    | Structured validation error (Zod enum).                                            |
| Importance sort       | `search_entries(project_number: 5, query: "test", sort_by: "importance")` | Returns entries with `importanceScore` field, sorted descending.                   |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using the `memory://metrics/tokens` and `memory://metrics/summary` server resources, DO NOT use scripts to parse filesystem responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Zod boundary limits prevent crashes.
- Invalid dates return structured Domain/Validation errors.
- No raw `-32602` responses.
- Invalid `sort_by` value returns structured Zod validation error.
- Valid `sort_by: 'importance'` returns entries with `importanceScore` field sorted descending.
