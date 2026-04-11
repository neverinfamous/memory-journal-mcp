# Re-Test memory-journal-mcp — Semantic Search & Analytics

**Scope:** Semantic/vector search, vector index management, statistics analytics, and cross-project insights.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present (vector index rebuilt). MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 3.2: Semantic Search

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

## Phase 3.3: Analytics & Index Management

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

- [ ] `semantic_search` accepts `entry_id` (Related by ID) in lieu of `query` string
- [ ] `semantic_search` incorporates metadata filtering (`tags`, `entry_type`, dates) into similarity results
- [ ] `semantic_search` with custom `similarity_threshold` affects result count
- [ ] `get_statistics` returns all 4 enhanced analytics metrics with correct groupings
- [ ] `get_cross_project_insights` returns `project_count ≥ 1` with seed entries S7, S13, S14 present (project 5 has 3 entries, meeting `min_entries: 3`)
- [ ] `get_cross_project_insights` response includes `top_tags`, `first_entry`, `last_entry`, `active_days`, `time_distribution` per project
- [ ] `get_cross_project_insights` returns all required schema fields (including `projects: []`) when empty (tested with `min_entries: 9999`)
