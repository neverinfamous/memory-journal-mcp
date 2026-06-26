# Re-Test memory-journal-mcp — Entry CRUD

**Scope:** Create, read, update, and delete entry operations (24 core tools — CRUD subset).

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas (e.g., Team Tools, Admin Tools).
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- **Required Tool Groups:** `admin`, `codemode`, `core`, `github`
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 2: Entry CRUD Operations

### 2.1 Create Entry

| Test                 | Command/Action                                                                                                                 | Expected Result                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Minimal create       | `create_entry(project_number: 5, content: "Test entry")`                                                               | Returns entry ID                                                                      |
| Full create          | `create_entry(project_number: 5, content: "...", entry_type: "planning", tags: ["test"])`                                      | Entry created with metadata                                                           |
| With GitHub linking  | `create_entry(project_number: 5, ..., issue_number: <N>)`                                                                      | Entry links to issue                                                                  |
| issueUrl auto-pop    | `create_entry(project_number: 5, content: "...", issue_number: <N>)` — omit issueUrl                                           | `issueUrl` auto-populated from cached repo info (requires prior `get_github_context`) |
| Invalid entry_type   | `create_entry(project_number: 5, content: "test", entry_type: "invalid")`                                                      | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| Invalid significance | `create_entry(project_number: 5, content: "test", significance_type: "invalid")`                                               | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| With PR fields       | `create_entry(project_number: 5, content: "PR test", pr_number: 67, pr_status: "merged")`                                      | Entry created with `prNumber`, `prStatus` fields persisted                            |
| With workflow fields | `create_entry(project_number: 5, content: "CI test", workflow_run_id: 123, workflow_name: "CI", workflow_status: "completed")` | Entry created with all workflow fields persisted                                      |
| With project_owner   | `create_entry(content: "...", project_number: 5, project_owner: "neverinfamous")`                                              | Entry created with `projectOwner` field                                               |
| auto_context off     | `create_entry(project_number: 5, content: "No context", auto_context: false)`                                                  | Entry created without auto-generated context                                          |
| share_with_team      | `create_entry(project_number: 5, content: "Shared entry", share_with_team: true)`                                              | Entry in personal DB + team DB; response has `sharedWithTeam: true`, `author`         |
| Default Type         | `create_entry(project_number: 5, content: "Type omitted")`                                                                     | Type defaults to "note"                                                               |
| Unrecognized Fields  | `create_entry(project_number: 5, content: "...", random_field: "ignore_me")`                                                   | Safe ignore (no crash), entry creates normally                                        |
| Create No Project    | `create_entry(content: "No project test")` (without `project_number`)                                                          | Fails with `VALIDATION_ERROR` ("Missing project_number..."). *(Note: If `DEFAULT_PROJECT_NUMBER` is configured on the server, this will succeed instead of erroring. If so, remove the default and re-test).* |



---
## Success Criteria
- Agent reports the Total Token Estimate in the final summary.
- create_entry persists all optional fields: PR fields, workflow fields, projectOwner, utoContext
- create_entry with share_with_team: true creates entries in both personal and team DBs
- create_entry rejects invalid entry_type and significance_type with structured errors
- create_entry with issue_number auto-populates issueUrl from cached repo info
- Creating entries with tags stores and returns tags properly
- Creating an entry without a project_number correctly triggers a validation error

