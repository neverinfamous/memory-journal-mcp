# Re-Test memory-journal-mcp — GitHub Integration (Milestones)

**Scope:** GitHub write tools — issue lifecycle, Kanban mutations, milestones lifecycle, and test cleanup.

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


### 13.4 Milestone Tools

> [!CAUTION]
> These tools **create, modify, and delete real GitHub milestones**. Clean up test milestones after testing.

| Test                 | Command/Action                                                                                   | Expected Result                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| List milestones      | `get_github_milestones(state: "open")`                                                           | Returns milestones array with `completion_percentage`, `open_issues`                                              |
| List all states      | `get_github_milestones(state: "all")`                                                            | Returns both open and closed milestones                                                                           |
| Get milestone detail | `get_github_milestone(milestone_number: <N>)`                                                    | Returns single milestone with full metadata                                                                       |
| Create milestone     | `create_github_milestone(title: "Test Milestone", description: "Testing", due_on: "YYYY-MM-DD")` | Returns `success: true`, created milestone with number and URL (⚠️ `due_on` must be `YYYY-MM-DD`, not ISO 8601)   |
| Update milestone     | `update_github_milestone(milestone_number: <new>, description: "Updated description")`           | Returns `success: true`, updated milestone                                                                        |
| Close milestone      | `update_github_milestone(milestone_number: <new>, state: "closed")`                              | Milestone state changed to `closed`                                                                               |
| Delete milestone     | `delete_github_milestone(milestone_number: <new>, confirm: true)`                                | Returns `success: true`, milestone removed from GitHub                                                            |
| Get nonexistent      | `get_github_milestone(milestone_number: 999999)`                                                 | Structured error: `{ error: "Milestone #999999 not found" }`                                                      |
| Milestone resource   | Read `memory://github/milestones/memory-journal-mcp`                                             | Static resource lists open milestones with completion %                                                           |
| Milestone detail     | Read `memory://milestones/memory-journal-mcp/<N>`                                                | Template resource shows milestone with completion %, openIssues + closedIssues counts, and hint for issue details |

### 13.7 GitHub Test Cleanup

> [!IMPORTANT]
> After GitHub testing, ensure all test artifacts are removed. Use the checklist below.

| Cleanup Step           | Command/Action                                                    |
|

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- GitHub issue lifecycle tools create/close issues correctly
- `create_github_issue_with_entry` with `body`, `labels`, `initial_status`, `entry_content` works
- `create_github_issue_with_entry` with `milestone_number` assigns issue to milestone
- `close_github_issue_with_entry` returns structured error for already-closed issues
- `close_github_issue_with_entry` with `move_to_done: true` behavior correct with/without `DEFAULT_PROJECT_NUMBER`
- Milestone CRUD lifecycle works end-to-end (create → update → close → delete)
- `memory://milestones/{repo}/{number}` returns milestone with completion %, issue counts, and hint
- All GitHub test artifacts cleaned up after testing