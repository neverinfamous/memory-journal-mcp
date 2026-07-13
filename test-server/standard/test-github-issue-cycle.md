# Re-Test memory-journal-mcp — GitHub Integration (Issue Lifecycle)

**Scope:** GitHub write tools — issue lifecycle, Kanban mutations, milestones lifecycle, and test cleanup.

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


### 13.2 Issue Lifecycle Tools

> [!CAUTION]
> These tools **create and close real GitHub issues**. Use with awareness.

| Test                          | Command/Action                                                                                                                                                                                       | Expected Result                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create issue + entry          | `create_github_issue_with_entry(title: "Test: Unreleased Verification", workspace_id: "test-ws")`                                                                                                          | GitHub issue created + journal entry created + added to project                                                                                                                                                                                               |
| Create with milestone         | `create_github_issue_with_entry(title: "Test: Milestone", milestone_number: <N>)`                                                                                                                    | Issue assigned to milestone, verify on GitHub                                                                                                                                                                                                                 |
| Close issue + entry           | `close_github_issue_with_entry(issue_number: <new_issue>, resolution_notes: "Verified working")`                                                                                                     | Issue closed + resolution entry created                                                                                                                                                                                                                       |
| Close with move_to_done       | `close_github_issue_with_entry(issue_number: <new_issue>, move_to_done: true, workspace_id: "test-ws")`                                                                                                    | Issue closed + `kanban` block in response. `kanban.moved: true` expected — uses idempotent `addProjectItem` to resolve item ID directly (no board-scan race condition)                                                                                        |
| Create with full params       | `create_github_issue_with_entry(title: "Test: Full", body: "Description", labels: ["test"], workspace_id: "test-ws", initial_status: "In Progress", entry_content: "Custom journal text", tags: ["test"])` | Issue created with body/labels, project item in "In Progress", journal entry uses custom content                                                                                                                                                              |
| Close with comment            | `close_github_issue_with_entry(issue_number: <new_issue>, resolution_notes: "Done", comment: "Closing comment", tags: ["resolved"])`                                                                 | Issue closed with comment posted, entry tagged                                                                                                                                                                                                                |
| Close already closed          | `close_github_issue_with_entry(issue_number: <known_closed>)`                                                                                                                                        | Structured error: `{ success: false, error: "Issue #X is already closed" }`                                                                                                                                                                                   |
| Close move_to_done no project | `close_github_issue_with_entry(issue_number: <open_issue>, move_to_done: true)`                                                                                                                      | When `DEFAULT_WORKSPACE_ID` is configured: uses default project, issue closes (`success: true`), Kanban move attempted against default project. When NOT configured: `kanban: { moved: false, error: "workspace_id required when move_to_done is true" }` |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- GitHub issue lifecycle tools create/close issues correctly
- `create_github_issue_with_entry` with `body`, `labels`, `initial_status`, `entry_content` works
- `create_github_issue_with_entry` with `milestone_number` assigns issue to milestone
- `close_github_issue_with_entry` returns structured error for already-closed issues
- `close_github_issue_with_entry` with `move_to_done: true` behavior correct with/without `DEFAULT_WORKSPACE_ID`
- Milestone CRUD lifecycle works end-to-end (create → update → close → delete)
- `memory://milestones/{repo}/{number}` returns milestone with completion %, issue counts, and hint
- All GitHub test artifacts cleaned up after testing