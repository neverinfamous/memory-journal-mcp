# Re-Test memory-journal-mcp — GitHub Integration (Kanban)

**Scope:** GitHub write tools — issue lifecycle, Kanban mutations, milestones lifecycle, and test cleanup.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas (e.g., Team Tools, Admin Tools).
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- **Required Tool Groups:** `codemode`, `github`
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected. Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.
- **IMPORTANT**: In multi-workspace environments, always pass `repo: "memory-journal-mcp"` to GitHub tools to avoid silent fallbacks to the wrong repository.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---


### 13.3 Kanban Tools

| Test                | Command/Action                                                                     | Expected Result                                                       |
| ------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Get board           | `get_kanban_board(project_number: 5)`                                              | Returns board structure with columns/items                            |
| Kanban resource     | Read `memory://kanban/5`                                                           | JSON board data                                                       |
| Kanban diagram      | Read `memory://kanban/5/diagram`                                                   | Raw Mermaid text (`text/plain` MIME), not JSON-wrapped                |
| Move item           | `move_kanban_item(project_number: 5, item_id: <id>, target_status: "In Progress")` | Item status updated                                                   |
| Move invalid status | `move_kanban_item(project_number: 5, item_id: <id>, target_status: "Nonexistent")` | Structured error with `availableStatuses` array listing valid options |
| Board nonexistent   | `get_kanban_board(project_number: 99999)`                                          | Structured error: `{ error: "Project #99999 not found..." }`          |

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