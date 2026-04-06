# Test memory-journal-mcp — Entry CRUD

**Scope:** Create, read, update, and delete entry operations (24 core tools — CRUD subset).

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. User verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   * **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

---

## Phase 2: Entry CRUD Operations

### 2.1 Create Entry

| Test                 | Command/Action                                                                                              | Expected Result                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Minimal create       | `create_entry_minimal(content: "Test entry")`                                                               | Returns entry ID                                                                      |
| Full create          | `create_entry(content: "...", entry_type: "planning", tags: ["test"])`                                      | Entry created with metadata                                                           |
| With GitHub linking  | `create_entry(..., issue_number: <N>)`                                                                      | Entry links to issue                                                                  |
| issueUrl auto-pop    | `create_entry(content: "...", issue_number: <N>)` — omit issueUrl                                           | `issueUrl` auto-populated from cached repo info (requires prior `get_github_context`) |
| Invalid entry_type   | `create_entry(content: "test", entry_type: "invalid")`                                                      | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| Invalid significance | `create_entry(content: "test", significance_type: "invalid")`                                               | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| With PR fields       | `create_entry(content: "PR test", pr_number: 67, pr_status: "merged")`                                      | Entry created with `prNumber`, `prStatus` fields persisted                            |
| With workflow fields | `create_entry(content: "CI test", workflow_run_id: 123, workflow_name: "CI", workflow_status: "completed")` | Entry created with all workflow fields persisted                                      |
| With project_owner   | `create_entry(content: "...", project_number: 5, project_owner: "neverinfamous")`                           | Entry created with `projectOwner` field                                               |
| auto_context off     | `create_entry(content: "No context", auto_context: false)`                                                  | Entry created without auto-generated context                                          |
| share_with_team      | `create_entry(content: "Shared entry", share_with_team: true)`                                              | Entry in personal DB + team DB; response has `sharedWithTeam: true`, `author`         |

### 2.2 Read & Update

| Test                      | Command/Action                                                 | Expected Result                                                          |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Get by ID                 | `get_entry_by_id(entry_id: <N>)`                               | Returns `structuredContent` with relationships                           |
| Importance score          | `get_entry_by_id(entry_id: <N>)`                               | Response includes `importance` field (0.0-1.0) and `importanceBreakdown` |
| No relationships          | `get_entry_by_id(entry_id: <N>, include_relationships: false)` | Response omits `relationships` array (or returns empty)                  |
| Update tags               | `update_entry(entry_id: <N>, tags: ["updated"])`               | Tags changed                                                             |
| Update content            | `update_entry(entry_id: <N>, content: "Updated content")`      | Content changed; verify via `get_entry_by_id`                            |
| Update entry_type         | `update_entry(entry_id: <N>, entry_type: "technical_note")`    | Entry type changed                                                       |
| Update is_personal        | `update_entry(entry_id: <N>, is_personal: false)`              | `isPersonal` toggled                                                     |
| Update nonexistent        | `update_entry(entry_id: 999999, tags: ["x"])`                  | Returns `{ success: false, error: "Entry 999999 not found" }`            |
| Update invalid type       | `update_entry(entry_id: <N>, entry_type: "invalid")`           | Structured error listing valid enum values                               |
| Get recent                | `get_recent_entries(limit: 5)`                                 | Returns `structuredContent` array                                        |
| Get recent (personal)     | `get_recent_entries(limit: 5, is_personal: true)`              | Only personal entries returned                                           |
| Get recent (not personal) | `get_recent_entries(limit: 5, is_personal: false)`             | Only non-personal entries returned                                       |

### 2.3 Delete (Test Last!)

| Test                     | Command/Action                                        | Expected Result                                           |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------------------- |
| Soft delete              | `delete_entry(entry_id: <test_id>, permanent: false)` | Entry hidden from search                                  |
| Permanent delete         | `delete_entry(entry_id: <test_id>, permanent: true)`  | Entry removed                                             |
| Delete nonexistent entry | `delete_entry(entry_id: 999999, permanent: false)`    | Returns `success: false, error: "Entry 999999 not found"` |

---

## Success Criteria

- [ ] `create_entry` persists all optional fields: PR fields, workflow fields, `projectOwner`, `autoContext`
- [ ] `create_entry` with `share_with_team: true` creates entries in both personal and team DBs
- [ ] `create_entry` rejects invalid `entry_type` and `significance_type` with structured errors (not raw throws)
- [ ] `create_entry` with `issue_number` auto-populates `issueUrl` from cached repo info
- [ ] `get_entry_by_id` returns `importance` score (0.0-1.0) and `importanceBreakdown`
- [ ] `get_recent_entries` with `is_personal` filter returns only matching entries
- [ ] `update_entry` returns `success: false` for nonexistent entry IDs
- [ ] `delete_entry` returns `success: false` for nonexistent entry IDs
