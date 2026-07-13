# Re-Test memory-journal-mcp — Entry CRUD

**Scope:** Create, read, update, and delete entry operations (24 core tools — CRUD subset).

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 2: Entry CRUD Operations

### 2.1 Create Entry

| Test                 | Command/Action                                                                                                                 | Expected Result                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Minimal create       | `create_entry(workspace_id: "test-ws", content: "Test entry")`                                                               | Returns entry ID                                                                      |
| Full create          | `create_entry(workspace_id: "test-ws", content: "...", entry_type: "planning", tags: ["test"])`                                      | Entry created with metadata                                                           |
| With GitHub linking  | `create_entry(workspace_id: "test-ws", ..., issue_number: <N>)`                                                                      | Entry links to issue                                                                  |
| issueUrl auto-pop    | `create_entry(workspace_id: "test-ws", content: "...", issue_number: <N>)` — omit issueUrl                                           | `issueUrl` auto-populated from cached repo info (requires prior `get_github_context`) |
| Invalid entry_type   | `create_entry(workspace_id: "test-ws", content: "test", entry_type: "invalid")`                                                      | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| Invalid significance | `create_entry(workspace_id: "test-ws", content: "test", significance_type: "invalid")`                                               | Structured error: `{ success: false, error: "..." }` listing valid enum values        |
| With PR fields       | `create_entry(workspace_id: "test-ws", content: "PR test", pr_number: 67, pr_status: "merged")`                                      | Entry created with `prNumber`, `prStatus` fields persisted                            |
| With workflow fields | `create_entry(workspace_id: "test-ws", content: "CI test", workflow_run_id: 123, workflow_name: "CI", workflow_status: "completed")` | Entry created with all workflow fields persisted                                      |
| With project_owner   | `create_entry(content: "...", project_owner: "neverinfamous")`                                              | Entry created with `projectOwner` field                                               |
| auto_context off     | `create_entry(workspace_id: "test-ws", content: "No context", auto_context: false)`                                                  | Entry created without auto-generated context                                          |
| share_with_team      | `create_entry(workspace_id: "test-ws", content: "Shared entry", share_with_team: true)`                                              | Entry in personal DB + team DB; response has `sharedWithTeam: true`, `author`         |
| Default Type         | `create_entry(workspace_id: "test-ws", content: "Type omitted")`                                                                     | Type defaults to "note"                                                               |
| Unrecognized Fields  | `create_entry(workspace_id: "test-ws", content: "...", random_field: "ignore_me")`                                                   | Safe ignore (no crash), entry creates normally                                        |
| Create No Project    | `create_entry(content: "No project test")` (without `workspace_id`)                                                          | Fails with `VALIDATION_ERROR` ("Missing workspace_id..."). *(Note: If `DEFAULT_WORKSPACE_ID` is configured on the server, this will succeed instead of erroring. If so, remove the default and re-test).* |



---
## Success Criteria
- Agent reports the Total Token Estimate in the final summary.
- create_entry persists all optional fields: PR fields, workflow fields, projectOwner, utoContext
- create_entry with share_with_team: true creates entries in both personal and team DBs
- create_entry rejects invalid entry_type and significance_type with structured errors
- create_entry with issue_number auto-populates issueUrl from cached repo info
- Creating entries with tags stores and returns tags properly
- Creating an entry without a workspace_id correctly triggers a validation error

