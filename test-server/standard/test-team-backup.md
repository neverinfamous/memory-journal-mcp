
# Re-Test memory-journal-mcp — Team Backup

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `admin`, `team`, `codemode`
- **Validation:** Ensure strict mode and boundary limits.
- **Use direct MCP tools exclusively.**
- Seed data from `test-seed.md` must be present.
- `TEAM_DB_PATH` configured.

---


### 14.13 Team Backup

| Test              | Command/Action                          | Expected Result                                            |
| ----------------- | --------------------------------------- | ---------------------------------------------------------- |
| Named backup      | `team_backup(name: "team-test-backup")` | `success: true`, `filename`, `path`, `sizeBytes`           |
| Auto-named backup | `team_backup`                           | Backup created with auto-generated timestamped name        |
| List backups      | `team_list_backups`                     | `backups` array with metadata, `total`, `backupsDirectory` |

---

