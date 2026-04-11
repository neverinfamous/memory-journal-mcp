# Test memory-journal-mcp — Search Tool Group

**Scope:** Deterministic verification of the Search tool group (`search_entries`, `search_by_date_range`, `semantic_search`) against the strict error handling matrix.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls. Retrieve token estimates using the built-in audit/metric resources (`memory://metrics/tokens` and `memory://metrics/summary`) instead of executing standalone scripts.

**Prerequisites:** Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

## 1. Structured Error Matrix

| Tool                   | Happy Path             | Domain Error Test                                                       | Zod Empty Param (`{}`)            | Zod Type Mismatch                             |
| ---------------------- | ---------------------- | ----------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| `search_entries`       | Search by valid string | N/A                                                                     | ⚠️ Should return validation error | `limit: "abc"`                                |
| `search_by_date_range` | Search valid range     | `start_date: "2026-12-31", end_date: "2026-01-01"` (inverted)           | ⚠️ Should return validation error | `start_date: "Jan 1"`                         |
| `semantic_search`      | Search by meaning      | Vector manager unavailable (returns `{ success: false, error: "..." }`) | ⚠️ Should return validation error | `limit: "abc"`, `similarity_threshold: "abc"` |

## 2. Integrity & Boundary Testing

| Test                  | Action                                              | Verification                                                                       |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Maximum Limit         | `search_entries(..., limit: 500)`                   | Returns 500 or fewer entries.                                                      |
| Limit Exceeded        | `search_entries(..., limit: 501)`                   | Structured validation error.                                                       |
| Threshold Limits      | `semantic_search(..., similarity_threshold: 0.0)`   | Returns all indexed entries.                                                       |
| Threshold Limits      | `semantic_search(..., similarity_threshold: 1.0)`   | Returns exact match or zero entries.                                               |
| Soft Delete Isolation | Search after deleting entry                         | Verify deleted entry does not appear in search results or semantic search results. |
| Filter Ignored Bug    | `search_by_date_range` with `issue_number: 44`      | ⚠️ Verify if issue filter applies (should not silently ignore).                    |
| Filter Ignored Bug    | `search_by_date_range` with `workflow_run_id: 999`  | ⚠️ Verify if filter applies.                                                       |
| Invalid sort_by       | `search_entries(query: "test", sort_by: "invalid")` | Structured validation error (Zod enum).                                            |
| Importance sort       | `search_entries(query: "test", sort_by: "importance")` | Returns entries with `importanceScore` field, sorted descending.                |

## Success Criteria

- [ ] Agent reports the Total Token Estimate in the final summary (using the `memory://metrics/tokens` and `memory://metrics/summary` server resources, DO NOT use scripts to parse filesystem responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- [ ] Zod boundary limits prevent crashes.
- [ ] Invalid dates return structured Domain/Validation errors.
- [ ] No raw `-32602` responses.
- [ ] Invalid `sort_by` value returns structured Zod validation error.
- [ ] Valid `sort_by: 'importance'` returns entries with `importanceScore` field sorted descending.
