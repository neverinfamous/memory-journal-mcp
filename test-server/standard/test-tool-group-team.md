# Re-Test memory-journal-mcp — Team Tool Group

**Execution Strategy:** **Use direct MCP tools whenever possible.** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls. To verify Zod boundary violations or empty schemas, the agent MUST use **Code Mode (`mj_execute_code`)** via the internal API (e.g. `mj.team.create({})`). No external TS testing scripts are necessary.

**Scope:** Deterministic verification of Team tools (`team_create_entry`, `team_search`, etc.) against strict error handling constraints.

**Prerequisites:** Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

## 1. Structured Error Matrix

| Tool                        | Domain Error Test                                    | Zod Empty Param (`{}`)            | Zod Type Mismatch |
| --------------------------- | ---------------------------------------------------- | --------------------------------- | ----------------- |
| All Team Tools              | Team DB not configured -> Returns `{success: false}` | N/A                               | N/A               |
| `team_create_entry`         | `entry_type: "invalid"`                              | ⚠️ Should return validation error | `content: 123`    |
| `team_update_entry`         | `entry_id: 999999`                                   | ⚠️ Should return validation error | `entry_id: "abc"` |
| `team_search_by_date_range` | `start_date: "Jan 1"`                                | ⚠️ Should return validation error | `limit: "abc"`    |
| `team_merge_tags`           | `source_tag: "x"; target_tag: "x"`                   | ⚠️ Should return validation error | N/A               |

### Specific Domain Checks

- **Unavailable Team Vector**: Use `team_semantic_search` without vector initialization -> verify structured JSON error.
- **Team Insights**: Verify `team_get_cross_project_insights` returns the requisite fields even when the query returns absolutely zero rows.

## Success Criteria

- [x] Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- [x] Team Database missing context natively halts and warns user without crashing the MCP worker.
- [x] Missing models do not crash vector fallback pipelines.
