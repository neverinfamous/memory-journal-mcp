
# Re-Test memory-journal-mcp — Team IO & Export

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `admin`, `team`, `codemode`
- **Validation:** Ensure strict mode and boundary limits.
- **Use direct MCP tools exclusively.**
- Seed data from `test-seed.md` must be present.
- `TEAM_DB_PATH` configured.

---


### 14.12 Team IO & Export

| Test               | Command/Action                                                                      | Expected Result                           |
| ------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| Export JSON        | `team_export_entries(project_number: 5, format: "json", limit: 5)`                  | `format: "json"`, `data` string, `count`  |
| Export markdown    | `team_export_entries(project_number: 5, format: "markdown", limit: 5)`              | `format: "markdown"`, `data` string       |
| IO Export markdown | `team_export_markdown(project_number: 5, output_dir: "tmp_team_md", limit: 5)`      | Generates local `.md` files in target dir |
| IO Import external | `team_import_external(project_number: 5, markdown_content: "...", dry_run: true)` | Parses external wiki format |
| IO Import dry run  | `team_import_markdown(project_number: 5, source_dir: "tmp_team_md", dry_run: true)` | Returns mock counts, resolves `author`    |

---

