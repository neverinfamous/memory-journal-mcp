
# Re-Test memory-journal-mcp — Hush Protocol

**Scope:** Hush Protocol (Team Flags) creation, resolution, updates, resources, and cleanup.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Required Tool Groups:** `team`, `codemode`
- **Validation:** Ensure strict mode and boundary limits.
- **Use direct MCP tools exclusively.**
- Seed data from `test-seed.md` must be present.
- `TEAM_DB_PATH` configured.

---

## Phase 14C: Hush Protocol
### 14.17 Hush Protocol — Flag Creation

| Test                | Command/Action                                                                                                                          | Expected Result                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Blocker flag        | `team_pass_flag(project_number: 5, flag_type: "blocker", message: "FK constraint blocks migration", target_user: "@sarah")`             | `success: true`, `flag_type: "blocker"`, `target_user: "sarah"`   |
| FYI flag            | `team_pass_flag(project_number: 5, flag_type: "fyi", message: "New lint rule added")`                                                   | `success: true`, no `target_user`                                 |
| Needs review        | `team_pass_flag(project_number: 5, flag_type: "needs_review", message: "Auth refactor ready", target_user: "chris", issue_number: <N>)` | Entry has `issueNumber` set                                       |
| Help requested      | `team_pass_flag(project_number: 5, flag_type: "help_requested", message: "Race condition on Windows")`                                  | `success: true`, all 4 vocabulary types accepted                  |
| With link           | `team_pass_flag(project_number: 5, flag_type: "blocker", message: "Migration file", link: "src/db/migrations/005.ts")`                  | `auto_context.link` populated                                     |
| With project_number | `team_pass_flag(flag_type: "fyi", message: "Scoped flag", project_number: 5)`                                                           | Entry has `projectNumber: 5`                                      |
| Omit project (error)| `team_pass_flag(flag_type: "fyi", message: "Missing project number test")` without server default                                      | `{ success: false, code: "VALIDATION_ERROR" }`                    |
| Omit project (ok)   | `team_pass_flag(flag_type: "fyi", message: "Fallback project number test")` with server default                                          | `success: true` (falls back to default project_number)            |
| Entry structure     | `team_get_entry_by_id(project_number: 5, entry_id: <flag_id>)`                                                                          | `entryType: "flag"`, tags include `flag:blocker` and `@sarah`     |
| Auto_context shape  | Inspect `autoContext` JSON from entry detail                                                                                            | Contains `flag_type`, `target_user`, `link`, `resolved: false`    |
| Invalid vocab       | `team_pass_flag(project_number: 5, flag_type: "urgent", message: "test")`                                                               | `{ success: false, code: "VALIDATION_ERROR" }`, lists valid types |
| Missing message     | `team_pass_flag(project_number: 5, flag_type: "blocker")`                                                                               | Structured error: message required                                |
| Missing flag_type   | `team_pass_flag(project_number: 5, message: "test")`                                                                                    | Structured error: flag_type required                              |
| Empty params        | `team_pass_flag(project_number: 5, {})`                                                                                                 | Structured error: both required                                   |


### 14.18 Hush Protocol — Flag Resolution

| Test                  | Command/Action                                                                           | Expected Result                                                 |
| --------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Resolve with comment  | `team_resolve_flag(project_number: 5, flag_id: <id>, resolution: "Fixed by migration")`  | `success: true`, `resolved: true`, `resolution` set             |
| Content marker        | `team_get_entry_by_id(project_number: 5, entry_id: <id>)` after resolve                  | Content contains `[RESOLVED: Fixed by migration]`               |
| Auto_context resolved | Inspect `autoContext` JSON after resolve                                                 | `resolved: true`, `resolved_at` ISO timestamp, `resolution` set |
| Idempotent re-resolve | `team_resolve_flag(project_number: 5, flag_id: <id>, resolution: "Should not override")` | `success: true`, original resolution retained                   |
| Bare resolve          | `team_resolve_flag(project_number: 5, flag_id: <new_flag>)` without resolution           | `success: true`, content contains `[RESOLVED]` (no comment)     |
| Nonexistent flag ID   | `team_resolve_flag(project_number: 5, flag_id: 999999)`                                  | `{ success: false, code: "RESOURCE_NOT_FOUND" }`                |
| Non-flag entry        | `team_resolve_flag(project_number: 5, flag_id: <non_flag_entry_id>)`                     | `{ success: false, code: "VALIDATION_ERROR" }`                  |
| Empty params          | `team_resolve_flag(project_number: 5, {})`                                               | Structured error: flag_id required                              |

### 14.19 Hush Protocol — Flag Resources

| Test               | URI                         | Expected Result                                                           |
| ------------------ | --------------------------- | ------------------------------------------------------------------------- |
| Active flags       | `memory://flags`            | JSON with `activeFlags` array, each with `flag_type`, `target_user`, etc. |
| No active flags    | `memory://flags`            | After resolving all flags — `activeFlags` empty or resource returns `[]`  |
| Flag vocabulary    | `memory://flags/vocabulary` | JSON with default vocabulary: blocker, needs_review, help_requested, fyi  |
| Briefing flags     | `memory://briefing`         | `activeFlags` section present when unresolved flags exist                 |
| Briefing localTime | `memory://briefing`         | `localTime` field present with human-readable timestamp                   |

### 14.20 Hush Protocol — Cleanup

| Test         | Command/Action                                                            | Expected Result               |
| ------------ | ------------------------------------------------------------------------- | ----------------------------- |
| Delete flags | `team_delete_entry(project_number: 5, entry_id: <flag_id>)` for each flag | All test flag entries removed |

---