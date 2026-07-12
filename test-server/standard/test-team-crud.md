
# Re-Test memory-journal-mcp — Team CRUD & Search

**Scope:** Team entry creation, read, search, and batch operations.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 14A: Team CRUD & Search
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas (e.g., Team Tools, Admin Tools).
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- **Required Tool Groups:** `admin`, `codemode`, `team`
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.


1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Clean up any test artifacts generated during the run (e.g., the `tmp_team_md` directory and its contents).
6. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.



>

### 14.1 Team Entry Creation

| Test               | Command/Action                                                                         | Expected Result                                             |
| ------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Basic create       | `team_create_entry(workspace_id: "test-ws", content: "Team test entry")`                     | `success: true`, `entry` with `author` field auto-populated |
| Explicit author    | `team_create_entry(workspace_id: "test-ws", content: "...", author: "TestBot")`              | `author: "TestBot"` in response                             |
| With tags          | `team_create_entry(workspace_id: "test-ws", content: "...", tags: ["team-test"])`            | Entry created with tags                                     |
| With issue linking | `team_create_entry(workspace_id: "test-ws", content: "...", issue_number: <N>)`              | `issueUrl` auto-populated from cached repo info             |
| With entry type    | `team_create_entry(workspace_id: "test-ws", content: "...", entry_type: "project_decision")` | Entry type set correctly                                    |
| Invalid entry_type | `team_create_entry(workspace_id: "test-ws", content: "...", entry_type: "invalid")`          | Structured error: `{ success: false, error: "..." }`        |

### 14.2 Team Batch Operations

| Test               | Command/Action                                                                         | Expected Result                                             |
| ------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Team Batch Create  | `team_batch_create_entries(workspace_id: "test-ws", entries: [{ content: "T1" }, { content: "T2" }])` | `success: true`, returns array of new entry IDs with `author` |
| Team Batch Limit   | `team_batch_create_entries(workspace_id: "test-ws", entries: [51 items])`                    | Structured error: `{ success: false, error: "..." }`        |
| Team Batch Update  | `team_batch_update_entries(workspace_id: "test-ws", updates: [{ entry_id: <id1>, content: "U1" }])`   | `success: true` and array of updated IDs                    |
| Team Batch Delete  | `team_batch_delete_entries(workspace_id: "test-ws", entry_ids: [<id1>, <id2>])`              | `success: true` and count of deleted entries                |

### 14.3 Team Read Tools

| Test                 | Command/Action                                                        | Expected Result                                  |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| Get recent           | `team_get_recent(workspace_id: "test-ws", limit: 5)`                        | `entries` array (each with `author`), `count`    |
| Default limit        | `team_get_recent(workspace_id: "test-ws")`                                  | Returns up to 10 entries (default)               |
| Get recent pag. pg 1 | `team_get_recent(workspace_id: "test-ws", limit: 2)`                        | Returns 2 entries and a non-empty `next_cursor`  |
| Get recent pag. pg 2 | `team_get_recent(workspace_id: "test-ws", limit: 2, cursor: "<next_cursor>")`| Returns next page of entries sequentially        |
| Search by text       | `team_search(workspace_id: "test-ws", query: "team test", mode: "fts")`     | Matching entries with `author` field             |
| Search (archived off)| `team_search(workspace_id: "test-ws", query: "test", include_archived: false)`| Excludes archived team entries from results      |
| Search (archived on) | `team_search(workspace_id: "test-ws", query: "test", include_archived: true)` | Returns archived team entries in results         |
| Search by tags       | `team_search(workspace_id: "test-ws", tags: ["team-test"])`                 | Tag-filtered results                             |
| Combined search      | `team_search(workspace_id: "test-ws", query: "test", tags: ["team-test"])`  | Text + tag filtered results                      |
| Hybrid search        | `team_search(workspace_id: "test-ws", query: "how did we fix performance")` | Auto-mode routes to semantic+FTS5 RRF            |
| No query/tags        | `team_search(workspace_id: "test-ws")`                                      | Returns recent entries (fallback to `getRecent`) |

| Missing project no.  | `team_search(query: "test")`                                          | `{ success: false, code: "VALIDATION_ERROR" }`  |
| Cross-team search    | `cross_team_search(query: "test")`                                    | Searches all configured team DBs, returns entries tagged with `team_db` |
| Cross-team labels    | `cross_team_search(query: "test", team_dbs: ["primary"])`             | Restricts cross-team search to only the `primary` DB |


### 14.4 Team Entry Detail

| Test             | Command/Action                                                                          | Expected Result                                                  |
| ---------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Get by ID        | `team_get_entry_by_id(workspace_id: "test-ws", entry_id: <team_entry_id>)`                    | `success: true`, `entry` with `author`, optional `relationships` |
| With importance  | Inspect response                                                                        | `importance` object with `score` (0.0-1.0) and `breakdown`       |
| No relationships | `team_get_entry_by_id(workspace_id: "test-ws", entry_id: <id>, include_relationships: false)` | Response omits `relationships` array                             |
| Nonexistent ID   | `team_get_entry_by_id(workspace_id: "test-ws", entry_id: 999999)`                             | Structured error: `{ success: false, error: "..." }`             |

### 14.5 Team Tags

| Test       | Command/Action   | Expected Result                              |
| ---------- | ---------------- | -------------------------------------------- |
| List tags  | `team_list_tags` | `tags` array with `{ name, count }` per tag  |
| Tag counts | Inspect response | Counts match entries created with those tags |

### 14.6 Team Date Range Search

| Test             | Command/Action                                                                                                          | Expected Result                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Basic date range | `team_search_by_date_range(workspace_id: "test-ws", start_date: "2026-01-01", end_date: "2026-12-31")`                        | Returns `entries` array with `author` field, `count` |
| With entry_type  | `team_search_by_date_range(workspace_id: "test-ws", start_date: "2026-01-01", end_date: "2026-12-31", entry_type: "standup")` | Only `standup` entries returned                      |
| With tags filter | `team_search_by_date_range(workspace_id: "test-ws", start_date: "2026-01-01", end_date: "2026-12-31", tags: ["standup"])`     | Only entries with `standup` tag                      |
| Invalid date     | `team_search_by_date_range(workspace_id: "test-ws", start_date: "Jan 1", end_date: "Jan 31")`                                 | Structured error with YYYY-MM-DD hint                |