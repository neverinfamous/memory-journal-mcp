# Re-Test memory-journal-mcp - Entry Read & Update

**Scope:** Read, update, and delete entry operations.

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
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---
## Phase 2: Read, Update, Delete

### 2.2 Read & Update

| Test                      | Command/Action                                                                    | Expected Result                                                          |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Get by ID                 | `get_entry_by_id(workspace_id: "test-ws", entry_id: <N>)`                               | Returns `structuredContent` with relationships                           |
| Importance score          | `get_entry_by_id(workspace_id: "test-ws", entry_id: <N>)`                               | Response includes `importance` field (0.0-1.0) and `importanceBreakdown` |
| No relationships          | `get_entry_by_id(workspace_id: "test-ws", entry_id: <N>, include_relationships: false)` | Response omits `relationships` array (or returns empty)                  |

| Update tags               | `update_entry(workspace_id: "test-ws", entry_id: <N>, tags: ["updated"])`               | Tags changed                                                             |
| Update content            | `update_entry(workspace_id: "test-ws", entry_id: <N>, content: "Updated content")`      | Content changed; verify via `get_entry_by_id`                            |
| Update entry_type         | `update_entry(workspace_id: "test-ws", entry_id: <N>, entry_type: "technical_note")`    | Entry type changed                                                       |
| Update is_personal        | `update_entry(workspace_id: "test-ws", entry_id: <N>, is_personal: false)`              | `isPersonal` toggled                                                     |
| Update nonexistent        | `update_entry(workspace_id: "test-ws", entry_id: 999999, tags: ["x"])`                  | Returns `{ success: false, error: "Entry 999999 not found" }`            |
| Update with version       | `update_entry(workspace_id: "test-ws", entry_id: <N>, expected_version: <v>, content: "V2")` | Update succeeds; version increments                                      |
| Update conflict           | `update_entry(workspace_id: "test-ws", entry_id: <N>, expected_version: <stale_v>, content: "V3")` | Returns `VERSION_CONFLICT` error with latest entry payload               |
| Update invalid type       | `update_entry(workspace_id: "test-ws", entry_id: <N>, entry_type: "invalid")`           | Structured error listing valid enum values                               |
| History of new entry      | `get_entry_history(workspace_id: "test-ws", entry_id: <N>)`                             | Returns empty list (0 revisions)                                         |
| History after update      | `update_entry(..., content: "Changed"); get_entry_history(...)`                   | Returns 1 revision with `revisionNumber: 1` and previous content snapshot|
| History nonexistent entry | `get_entry_history(workspace_id: "test-ws", entry_id: 999999)`                          | Returns empty list or structured error                                   |
| Get recent                | `get_recent_entries(workspace_id: "test-ws", limit: 5)`                                 | Returns `structuredContent` array                                        |
| Get recent (personal)     | `get_recent_entries(workspace_id: "test-ws", limit: 5, is_personal: true)`              | Only personal entries returned                                           |
| Get recent (not personal) | `get_recent_entries(workspace_id: "test-ws", limit: 5, is_personal: false)`             | Only non-personal entries returned                                       |

### 2.3 Delete (Test Last!)

| Test                     | Command/Action                                                           | Expected Result                                           |
| ------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| Soft delete              | `delete_entry(workspace_id: "test-ws", entry_id: <test_id>, permanent: false)` | Entry hidden from search                                  |
| Permanent delete         | `delete_entry(workspace_id: "test-ws", entry_id: <test_id>, permanent: true)`  | Entry removed                                             |
| Delete nonexistent entry | `delete_entry(workspace_id: "test-ws", entry_id: 999999, permanent: false)`    | Returns `success: false, error: "Entry 999999 not found"` |

### 2.4 Soft-Delete Recovery, Archiving & Cursor Pagination

| Test                      | Command/Action                                                                                                                    | Expected Result                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| List deleted initially    | `list_deleted_entries(workspace_id: "test-ws")`                                                                                         | Returns empty list or list of previously soft-deleted entries                             |
| Soft delete for recovery   | `delete_entry(workspace_id: "test-ws", entry_id: <test_id>, permanent: false)`                                                          | Entry hidden from standard queries; appears in `list_deleted_entries`                     |
| Restore entry             | `restore_entry(workspace_id: "test-ws", entry_id: <test_id>)`                                                                           | Entry restored (`is_deleted = 0`); no longer in `list_deleted_entries`; visible in search |
| Restore nonexistent       | `restore_entry(workspace_id: "test-ws", entry_id: 999999)`                                                                              | Structured error: `{ success: false, error: "Entry 999999 not found" }`                   |
| Set archived              | `update_entry(workspace_id: "test-ws", entry_id: <test_id>, is_archived: true)`                                                         | `isArchived` set to `true` (verified via `get_entry_by_id`)                               |
| Get recent (archived off) | `get_recent_entries(workspace_id: "test-ws", limit: 10, include_archived: false)` (or omit parameter)                                   | Default search/recent excludes archived entry                                             |
| Get recent (archived on)  | `get_recent_entries(workspace_id: "test-ws", limit: 10, include_archived: true)`                                                        | Returns the archived entry in the list                                                    |
| Cursor pagination page 1  | `get_recent_entries(workspace_id: "test-ws", limit: 2)`                                                                                 | Returns 2 entries and a non-empty `next_cursor` string                                    |
| Cursor pagination page 2  | `get_recent_entries(workspace_id: "test-ws", limit: 2, cursor: "<next_cursor>")`                                                        | Returns next page of entries; continues sequentially                                      |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.

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

