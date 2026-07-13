# Re-Test memory-journal-mcp — Semantic Search & Analytics

**Scope:** Semantic/vector search, vector index management, statistics analytics, and cross-project insights.

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

## Phase 4: Semantic Search

| Test                   | Command/Action                                                     | Expected Result                                                                     |
| ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Vector index stats     | `get_vector_index_stats`                                           | Shows `itemCount`, `modelName`, `dimensions`                                        |
| Rebuild index          | `rebuild_vector_index`                                             | `entriesIndexed` > 0 (indexes seed entries)                                         |
| Semantic query         | `semantic_search(query: "improving performance")`                  | ≥ 1 result — S7, S10 semantically similar                                           |
| Related by ID          | `semantic_search(entry_id: <S7_id>)`                               | Returns S10 natively, no query string required, bypassing inference                 |
| Custom threshold       | `semantic_search(query: "performance", similarity_threshold: 0.5)` | Fewer results than default threshold (0.25)                                         |
| Personal filter        | `semantic_search(query: "test", is_personal: true)`                | Only personal entries in results                                                    |
| Tags filter            | `semantic_search(query: "test", tags: ["testing"])`                | Only entries with "testing" tag in results                                          |
| Dates filter           | `semantic_search(query: "test", start_date: "2026-01-01")`         | Only newer entries in results                                                       |
| Hint disabled          | `semantic_search(query: "xyznonexistent", hint_on_empty: false)`   | Noise results with quality gate `hint` still shown (only advisory hints suppressed) |
| Hint enabled (default) | `semantic_search(query: "xyznonexistent")`                         | Noise results with quality gate `hint` (all hints shown)                            |

## Phase 4.2: Analytics & Index Management

| Test                     | Command/Action                                                                 | Expected Result                                                                          |
| ------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Stats group by month     | `get_statistics(group_by: "month")`                                            | Periods grouped by month                                                                 |
| Stats group by day       | `get_statistics(group_by: "day")`                                              | Periods grouped by day                                                                   |
| Stats with dates         | `get_statistics(start_date: "2026-01-01", end_date: "2026-03-01")`             | Returns `dateRange` in response; results filtered to date range                          |
| Stats project breakdown  | `get_statistics(project_breakdown: true)`                                      | Returns `projectBreakdown` array with per-project stats                                  |
| Cross-project insights   | `get_cross_project_insights`                                                   | `project_count ≥ 1`, `projects` array with project 5 (entry_count ≥ 3, top_tags present) |
| Insights with dates      | `get_cross_project_insights(start_date: "2026-01-01", end_date: "2026-03-01")` | Date-filtered project insights — project 5 visible if S7/S13/S14 within range            |
| Insights min_entries     | `get_cross_project_insights(min_entries: 1)`                                   | Same or more projects than default (min_entries: 3)                                      |
| Add to vector index      | `add_to_vector_index(entry_id: <existing_id>)`                                 | `success: true`, `entryId` in response                                                   |
| Add nonexistent to index | `add_to_vector_index(entry_id: 999999)`                                        | Returns `{ success: false, error: "..." }`                                               |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `semantic_search` accepts `entry_id` (Related by ID) in lieu of `query` string
- `semantic_search` incorporates metadata filtering (`tags`, `entry_type`, dates) into similarity results
- `semantic_search` with custom `similarity_threshold` affects result count
- `get_statistics` returns all 4 enhanced analytics metrics with correct groupings
- `get_cross_project_insights` returns `project_count ≥ 1` with seed entries S7, S13, S14 present (project 5 has 3 entries, meeting `min_entries: 3`)
- `get_cross_project_insights` response includes `top_tags`, `first_entry`, `last_entry`, `active_days`, `time_distribution` per project
- `get_cross_project_insights` returns all required schema fields (including `projects: []`) when empty (tested with `min_entries: 9999`)
