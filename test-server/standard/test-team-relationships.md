
# Re-Test memory-journal-mcp — Team Relationships

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `admin`, `team`, `codemode`
- **Validation:** Ensure strict mode and boundary limits.
- **Use direct MCP tools exclusively.**
- Seed data from `test-seed.md` must be present.
- `TEAM_DB_PATH` configured.

---


### 14.11 Team Relationships

| Test                  | Command/Action                                                                                                                    | Expected Result                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Link entries          | `team_link_entries(project_number: 5, from_entry_id: <A>, to_entry_id: <B>, relationship_type: "references")`                     | `success: true`, `relationship` object               |
| Link with description | `team_link_entries(project_number: 5, from_entry_id: <A>, to_entry_id: <B>, relationship_type: "implements", description: "...")` | Relationship created with `description`              |
| Duplicate link        | Call `team_link_entries(project_number: 5)` again with same params                                                                | `duplicate: true`, `message`                         |
| Link nonexistent      | `team_link_entries(project_number: 5, from_entry_id: 999999, to_entry_id: <B>, ...)`                                              | Structured error: `{ success: false, error: "..." }` |
| Visualize by entry    | `team_visualize_relationships(project_number: 5, entry_id: <A>)`                                                                  | `mermaid` string, `nodeCount`, `edgeCount`           |
| Visualize by tag      | `team_visualize_relationships(project_number: 5, tag: "team-test")`                                                               | Mermaid diagram scoped to tag                        |
| Visualize nonexistent | `team_visualize_relationships(project_number: 5, entry_id: 999999)`                                                               | Structured error or empty diagram                    |

---

