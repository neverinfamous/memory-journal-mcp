
# Re-Test memory-journal-mcp — Team Vector Search

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `admin`, `team`, `codemode`
- **Validation:** Ensure strict mode and boundary limits.
- **Use direct MCP tools exclusively.**
- Seed data from `test-seed.md` must be present.
- `TEAM_DB_PATH` configured.

---


### 14.9 Team Vector Search

| Test                    | Command/Action                                                                      | Expected Result                                     |
| ----------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Rebuild team index      | `team_rebuild_vector_index`                                                         | `success: true`, `entriesIndexed` > 0               |
| Team vector stats       | `team_get_vector_index_stats`                                                       | `available`, `itemCount`, `modelName`, `dimensions` |
| Team semantic query     | `team_semantic_search(project_number: 5, query: "team standup")`                    | ≥ 1 result with `similarity` score                  |
| Team related by ID      | `team_semantic_search(project_number: 5, entry_id: <team_entry_id>)`                | Semantically similar team entries bypassing strings |
| Team semantic threshold | `team_semantic_search(project_number: 5, query: "test", similarity_threshold: 0.5)` | Fewer results than default threshold (0.25)         |
| Team add to index       | `team_add_to_vector_index(project_number: 5, entry_id: <team_entry_id>)`            | `success: true`, `entryId` in response              |
| Team add nonexistent    | `team_add_to_vector_index(project_number: 5, entry_id: 999999)`                     | `{ success: false, error: "..." }`                  |

---

