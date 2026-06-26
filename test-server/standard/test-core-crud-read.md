# Re-Test memory-journal-mcp - Entry Read & Update

**Scope:** Read, update, and delete entry operations.

**Prerequisites:**
- **CRITICAL:** You MUST pass use_test_db: true as a top-level parameter in ALL MCP tool calls.
- **Use direct MCP tools exclusively.**
- Seed data from 	est-seed.md must be present.

**Workflow after testing:**
1. Fix any issues found.
2. Commit changes.
3. Report tokens.

---
## Phase 2: Read, Update, Delete

### 2.2 Read & Update

| Test                      | Command/Action                                                                    | Expected Result                                                          |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Get by ID                 | `get_entry_by_id(project_number: 5, entry_id: <N>)`                               | Returns `structuredContent` with relationships                           |
| Importance score          | `get_entry_by_id(project_number: 5, entry_id: <N>)`                               | Response includes `importance` field (0.0-1.0) and `importanceBreakdown` |
| No relationships          | `get_entry_by_id(project_number: 5, entry_id: <N>, include_relationships: false)` | Response omits `relationships` array (or returns empty)                  |
| 1.7 Default Type        | `create_entry(project_number: <test_project>, content: "Type omitted")`                        | Type defaults to "note"                                              |
| 1.8 Unrecognized Fields | `create_entry(project_number: <test_project>, content: "...", random_field: "ignore_me")`      | Safe ignore (no crash), entry creates normally                       |
| 1.9 Create No Project   | `create_entry(content: "No project test")` (without `project_number`)                          | Fails with `VALIDATION_ERROR` ("Missing project_number..."). *(Note: If `DEFAULT_PROJECT_NUMBER` is configured on the server, this will succeed instead of erroring. If so, remove the default and re-test).* |
| Update tags               | `update_entry(project_number: 5, entry_id: <N>, tags: ["updated"])`               | Tags changed                                                             |
| Update content            | `update_entry(project_number: 5, entry_id: <N>, content: "Updated content")`      | Content changed; verify via `get_entry_by_id`                            |
| Update entry_type         | `update_entry(project_number: 5, entry_id: <N>, entry_type: "technical_note")`    | Entry type changed                                                       |
| Update is_personal        | `update_entry(project_number: 5, entry_id: <N>, is_personal: false)`              | `isPersonal` toggled                                                     |
| Update nonexistent        | `update_entry(project_number: 5, entry_id: 999999, tags: ["x"])`                  | Returns `{ success: false, error: "Entry 999999 not found" }`            |
| Update with version       | `update_entry(project_number: 5, entry_id: <N>, expected_version: <v>, content: "V2")` | Update succeeds; version increments                                      |
| Update conflict           | `update_entry(project_number: 5, entry_id: <N>, expected_version: <stale_v>, content: "V3")` | Returns `VERSION_CONFLICT` error with latest entry payload               |
| Update invalid type       | `update_entry(project_number: 5, entry_id: <N>, entry_type: "invalid")`           | Structured error listing valid enum values                               |
| History of new entry      | `get_entry_history(project_number: 5, entry_id: <N>)`                             | Returns empty list (0 revisions)                                         |
| History after update      | `update_entry(..., content: "Changed"); get_entry_history(...)`                   | Returns 1 revision with `revisionNumber: 1` and previous content snapshot|
| History nonexistent entry | `get_entry_history(project_number: 5, entry_id: 999999)`                          | Returns empty list or structured error                                   |
| Get recent                | `get_recent_entries(project_number: 5, limit: 5)`                                 | Returns `structuredContent` array                                        |
| Get recent (personal)     | `get_recent_entries(project_number: 5, limit: 5, is_personal: true)`              | Only personal entries returned                                           |
| Get recent (not personal) | `get_recent_entries(project_number: 5, limit: 5, is_personal: false)`             | Only non-personal entries returned                                       |

### 2.3 Delete (Test Last!)

| Test                     | Command/Action                                                           | Expected Result                                           |
| ------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| Soft delete              | `delete_entry(project_number: 5, entry_id: <test_id>, permanent: false)` | Entry hidden from search                                  |
| Permanent delete         | `delete_entry(project_number: 5, entry_id: <test_id>, permanent: true)`  | Entry removed                                             |
| Delete nonexistent entry | `delete_entry(project_number: 5, entry_id: 999999, permanent: false)`    | Returns `success: false, error: "Entry 999999 not found"` |

### 2.4 Soft-Delete Recovery, Archiving & Cursor Pagination

| Test                      | Command/Action                                                                                                                    | Expected Result                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| List deleted initially    | `list_deleted_entries(project_number: 5)`                                                                                         | Returns empty list or list of previously soft-deleted entries                             |
| Soft delete for recovery   | `delete_entry(project_number: 5, entry_id: <test_id>, permanent: false)`                                                          | Entry hidden from standard queries; appears in `list_deleted_entries`                     |
| Restore entry             | `restore_entry(project_number: 5, entry_id: <test_id>)`                                                                           | Entry restored (`is_deleted = 0`); no longer in `list_deleted_entries`; visible in search |
| Restore nonexistent       | `restore_entry(project_number: 5, entry_id: 999999)`                                                                              | Structured error: `{ success: false, error: "Entry 999999 not found" }`                   |
| Set archived              | `update_entry(project_number: 5, entry_id: <test_id>, is_archived: true)`                                                         | `isArchived` set to `true` (verified via `get_entry_by_id`)                               |
| Get recent (archived off) | `get_recent_entries(project_number: 5, limit: 10, include_archived: false)` (or omit parameter)                                   | Default search/recent excludes archived entry                                             |
| Get recent (archived on)  | `get_recent_entries(project_number: 5, limit: 10, include_archived: true)`                                                        | Returns the archived entry in the list                                                    |
| Cursor pagination page 1  | `get_recent_entries(project_number: 5, limit: 2)`                                                                                 | Returns 2 entries and a non-empty `next_cursor` string                                    |
| Cursor pagination page 2  | `get_recent_entries(project_number: 5, limit: 2, cursor: "<next_cursor>")`                                                        | Returns next page of entries; continues sequentially                                      |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `create_entry` persists all optional fields: PR fields, workflow fields, `projectOwner`, `autoContext`
- `create_entry` with `share_with_team: true` creates entries in both personal and team DBs
- `create_entry` rejects invalid `entry_type` and `significance_type` with structured errors (not raw throws)
- `create_entry` with `issue_number` auto-populates `issueUrl` from cached repo info
- Creating entries with tags stores and returns tags properly
- Creating an entry without a `project_number` correctly triggers a validation error suggesting `DEFAULT_PROJECT_NUMBER` configuration (when no default is configured)
- Updating tags overwrites properly instead of merging
- `get_entry_by_id` returns `importance` score (0.0-1.0) and `importanceBreakdown`
- `get_recent_entries` with `is_personal` filter returns only matching entries
- `get_entry_history` correctly returns historical snapshots after updates
- `update_entry` successfully leverages `expected_version` to prevent overwriting concurrent edits (returns `VERSION_CONFLICT`)
- `update_entry` returns `success: false` for nonexistent entry IDs
- `delete_entry` returns `success: false` for nonexistent entry IDs
- `list_deleted_entries` discovers soft-deleted entries, and `restore_entry` successfully un-deletes them
- `is_archived` column and `include_archived` filter work seamlessly on CRUD reads
- `cursor` and `next_cursor` allow clean O(1) keyset pagination on `get_recent_entries`

