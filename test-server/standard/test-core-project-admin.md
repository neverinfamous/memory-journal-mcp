# Re-Test memory-journal-mcp — Project Admin

**Scope:** Project management operations (register, update, delete, get, and list projects).

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 8: Project Admin Tools

### 8.1 Project Management

| Test                   | Command/Action                                                                                              | Expected Result                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Register new project   | `register_project(project_name: "test-proj", default_owner: "dev", github_repo: "user/test-proj")`          | Project registered, returns project details including `project_number`             |
| List projects          | `list_projects`                                                                                             | Returns all projects, including the newly registered "test-proj"                   |
| Get project            | `get_project(project_number: <new_project_number>)`                                                         | Returns the specific details for the "test-proj" project                           |
| Update project         | `update_project(project_number: <new_project_number>, project_name: "updated-proj", is_active: false)`      | Project is updated and marked inactive                                             |
| Delete project         | `delete_project(project_number: <new_project_number>)`                                                      | Project is deleted                                                                 |
| Get deleted project    | `get_project(project_number: <new_project_number>)`                                                         | Structured error: `{ success: false, error: "Project not found..." }`              |
| Register duplicate     | `register_project(project_name: "test-proj", default_owner: "dev")` (run twice)                             | Second call may fail or succeed depending on unique constraint logic (verify schema)|
| Invalid project update | `update_project(project_number: 999999, project_name: "ghost")`                                             | Structured error: `{ success: false, error: "Project not found..." }`              |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `register_project` successfully registers a new project and returns the details.
- `list_projects` correctly includes the new project in its returned list.
- `get_project` retrieves the correct project.
- `update_project` correctly modifies the project details.
- `delete_project` successfully removes the project, and subsequent `get_project` calls return an error.
