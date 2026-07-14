# Re-Test memory-journal-mcp — GitHub Integration (Kanban)

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
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---


### 13.3 Kanban Tools

| Test                | Command/Action                                                                     | Expected Result                                                       |
| ------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Get board           | `get_kanban_board(workspace_id: "test-ws")`                                              | Returns board structure with columns/items                            |
| Kanban resource     | Read `memory://kanban/5`                                                           | JSON board data                                                       |
| Kanban diagram      | Read `memory://kanban/5/diagram`                                                   | Raw Mermaid text (`text/plain` MIME), not JSON-wrapped                |
| Move item           | `move_kanban_item(workspace_id: "test-ws", item_id: <id>, target_status: "In Progress")` | Item status updated                                                   |
| Move invalid status | `move_kanban_item(workspace_id: "test-ws", item_id: <id>, target_status: "Nonexistent")` | Structured error with `availableStatuses` array listing valid options |
| Board nonexistent   | `get_kanban_board(workspace_id: 99999)`                                          | Structured error: `{ error: "Project #99999 not found..." }`          |

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