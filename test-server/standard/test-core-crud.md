# Re-Test memory-journal-mcp — Entry CRUD

**Scope:** Create, read, update, and delete entry operations (24 core tools — CRUD subset).

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 2: Entry CRUD Operations

### 2.1 Create Entry

| Test                 | Command/Action                                                                                              | Expected Result                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Minimal create       | `create_entry_minimal(project_number: 5, content: "Test entry")`                                                               | Returns entry ID                                                                      |
| Full create          | `create_entry(project_number: 5, content: "...", entry_type: "planning", tags: ["test"])`                                      | Entry created with metadata                                                           |
| With GitHub linking  | `create_entry(project_number: 5, ..., issue_number: <N>)`                                                                      | Entry links to issue                                                                  |
| issueUrl auto-pop    | `create_entry(project_number: 5, content: "...", issue_number: <N>)` — omit issueUrl                                           | `issueUrl` auto-populated from cached repo info (requires prior `get_github_context`) |
| Invalid entry_type   | `create_entry(project_number: 5, content: "test", entry_type: "invalid")`                                                      | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| Invalid significance | `create_entry(project_number: 5, content: "test", significance_type: "invalid")`                                               | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| With PR fields       | `create_entry(project_number: 5, content: "PR test", pr_number: 67, pr_status: "merged")`                                      | Entry created with `prNumber`, `prStatus` fields persisted                            |
| With workflow fields | `create_entry(project_number: 5, content: "CI test", workflow_run_id: 123, workflow_name: "CI", workflow_status: "completed")` | Entry created with all workflow fields persisted                                      |
| With project_owner   | `create_entry(content: "...", project_number: 5, project_owner: "neverinfamous")`                           | Entry created with `projectOwner` field                                               |
| auto_context off     | `create_entry(project_number: 5, content: "No context", auto_context: false)`                                                  | Entry created without auto-generated context                                          |
| share_with_team      | `create_entry(project_number: 5, content: "Shared entry", share_with_team: true)`                                              | Entry in personal DB + team DB; response has `sharedWithTeam: true`, `author`         |

### 2.2 Read & Update

| Test                      | Command/Action                                                 | Expected Result                                                          |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Get by ID                 | `get_entry_by_id(project_number: 5, entry_id: <N>)`                               | Returns `structuredContent` with relationships                           |
| Importance score          | `get_entry_by_id(project_number: 5, entry_id: <N>)`                               | Response includes `importance` field (0.0-1.0) and `importanceBreakdown` |
| No relationships          | `get_entry_by_id(project_number: 5, entry_id: <N>, include_relationships: false)` | Response omits `relationships` array (or returns empty)                  |
| Update tags               | `update_entry(project_number: 5, entry_id: <N>, tags: ["updated"])`               | Tags changed                                                             |
| Update content            | `update_entry(project_number: 5, entry_id: <N>, content: "Updated content")`      | Content changed; verify via `get_entry_by_id`                            |
| Update entry_type         | `update_entry(project_number: 5, entry_id: <N>, entry_type: "technical_note")`    | Entry type changed                                                       |
| Update is_personal        | `update_entry(project_number: 5, entry_id: <N>, is_personal: false)`              | `isPersonal` toggled                                                     |
| Update nonexistent        | `update_entry(project_number: 5, entry_id: 999999, tags: ["x"])`                  | Returns `{ success: false, error: "Entry 999999 not found" }`            |
| Update invalid type       | `update_entry(project_number: 5, entry_id: <N>, entry_type: "invalid")`           | Structured error listing valid enum values                               |
| Get recent                | `get_recent_entries(project_number: 5, limit: 5)`                                 | Returns `structuredContent` array                                        |
| Get recent (personal)     | `get_recent_entries(project_number: 5, limit: 5, is_personal: true)`              | Only personal entries returned                                           |
| Get recent (not personal) | `get_recent_entries(project_number: 5, limit: 5, is_personal: false)`             | Only non-personal entries returned                                       |

### 2.3 Delete (Test Last!)

| Test                     | Command/Action                                        | Expected Result                                           |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------------------- |
| Soft delete              | `delete_entry(project_number: 5, entry_id: <test_id>, permanent: false)` | Entry hidden from search                                  |
| Permanent delete         | `delete_entry(project_number: 5, entry_id: <test_id>, permanent: true)`  | Entry removed                                             |
| Delete nonexistent entry | `delete_entry(project_number: 5, entry_id: 999999, permanent: false)`    | Returns `success: false, error: "Entry 999999 not found"` |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `create_entry` persists all optional fields: PR fields, workflow fields, `projectOwner`, `autoContext`
- `create_entry` with `share_with_team: true` creates entries in both personal and team DBs
- `create_entry` rejects invalid `entry_type` and `significance_type` with structured errors (not raw throws)
- `create_entry` with `issue_number` auto-populates `issueUrl` from cached repo info
- `get_entry_by_id` returns `importance` score (0.0-1.0) and `importanceBreakdown`
- `get_recent_entries` with `is_personal` filter returns only matching entries
- `update_entry` returns `success: false` for nonexistent entry IDs
- `delete_entry` returns `success: false` for nonexistent entry IDs
