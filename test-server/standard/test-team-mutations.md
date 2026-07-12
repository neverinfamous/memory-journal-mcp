
# Re-Test memory-journal-mcp — Team Admin & Recovery

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `admin`, `team`, `codemode`
- **Validation:** Ensure strict mode and boundary limits.
- **Use direct MCP tools exclusively.**
- Seed data from `test-seed.md` must be present.
- `TEAM_DB_PATH` configured.

---


### 14.7 Team Admin & Recovery

| Test                     | Command/Action                                                                          | Expected Result                                      |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Update content           | `team_update_entry(project_number: 5, entry_id: <id>, content: "Updated team content")` | `success: true`, `entry` with updated content        |
| Update omit project_no   | `team_update_entry(entry_id: <id>, content: "Updated without project number parameter")` | `success: true` (falls back to existing project number)|
| Update tags              | `team_update_entry(project_number: 5, entry_id: <id>, tags: ["updated-team"])`          | Tags changed on team entry                           |

| Update entry_type        | `team_update_entry(project_number: 5, entry_id: <id>, entry_type: "technical_note")`    | Entry type changed                                   |
| Update is_archived       | `team_update_entry(project_number: 5, entry_id: <id>, is_archived: true)`               | Entry is archived                                    |
| Update with version      | `team_update_entry(project_number: 5, entry_id: <id>, expected_version: <v>, content: "V2")`| `success: true`, version increments                  |
| Update conflict          | `team_update_entry(project_number: 5, entry_id: <id>, expected_version: <stale_v>, content: "V3")`| Structured error with `VERSION_CONFLICT` code       |
| Update nonexistent       | `team_update_entry(project_number: 5, entry_id: 999999, content: "x")`                  | Structured error: `{ success: false, error: "..." }` |
| Soft delete              | `team_delete_entry(project_number: 5, entry_id: <id>)`                                  | `success: true`, `message` confirming deletion       |
| List deleted entries     | `team_list_deleted_entries(project_number: 5)`                                          | Returns soft-deleted entry in the list               |
| Restore entry            | `team_restore_entry(project_number: 5, entry_id: <id>)`                                 | `success: true`, entry is restored (`is_deleted = 0`)|
| Restore nonexistent      | `team_restore_entry(project_number: 5, entry_id: 999999)`                               | Structured error: `{ success: false, error: "..." }` |
| Delete nonexistent       | `team_delete_entry(project_number: 5, entry_id: 999999)`                                | Structured error: `{ success: false, error: "..." }` |
| Merge tags               | `team_merge_tags(project_number: 5, source_tag: "team-old", target_tag: "team-new")`    | `success: true`, `entriesUpdated`, `sourceDeleted`   |
| Merge same tag           | `team_merge_tags(project_number: 5, source_tag: "team-new", target_tag: "team-new")`    | Structured error: `{ success: false, error: "..." }` |
| Merge nonexistent source | `team_merge_tags(project_number: 5, source_tag: "nonexistent-xyz", target_tag: "x")`    | Structured error: `{ success: false, error: "..." }` |

### 14.16 Cleanup

| Test        | Command/Action                                                        | Expected Result                 |
|

---

