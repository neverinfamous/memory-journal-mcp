# Re-Test memory-journal-mcp — Kanban Lifecycle

**Scope:** Tests the new Kanban tools `add_kanban_item` and `delete_kanban_item`, along with `move_kanban_item` and the optimized `get_kanban_board` to verify full lifecycle awareness and control.

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
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## 13.5.1 Board Discovery

| #   | Test                                       | Command                                | Expected Result                                                                                                   |
| --- | ------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Diagnose columns without pulling full body | `get_kanban_board(summary_only: true)` | Returns columns with `itemCount` and `itemDirectory` populated, while `items: []` is stripped to preserve tokens. |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `summaryOnly: true` is present.
- `itemDirectory` contains an ID, Title, and Status for topological mapping.

## 13.5.2 Lifecycle: Add -> Move -> Delete

| #   | Test                           | Command                                                           | Expected Result                                                          |
| --- | ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 2   | Link existing issue to Project | `add_kanban_item(issue_number: <#>)`                              | Success, returns `itemId` indicating it is tethered to the board.        |
| 3   | Move issue to target status    | `move_kanban_item(item_id: "<ID>", target_status: "In Progress")` | Success moving to "In Progress".                                         |
| 4   | Untether item from Project     | `delete_kanban_item(item_id: "<ID>")`                             | Success, removes from Kanban column without closing the actual Issue/PR. |

### Verification Checks

- `add_kanban_item` strictly utilizes integer `issue_number` seamlessly resolving it to `nodeId`.
- Item moves dynamically to non-default column natively.
- `delete_kanban_item` explicitly purges from topological board representation smoothly.

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Complete Add -> Move -> Remove pipeline succeeds consecutively.
- Token count optimized through `itemDirectory` vs traditional bloated pagination.
- Ensure the issue survives the `delete_kanban_item` mutation (check state `get_github_issue(issue_number: <#>)` is NOT closed).
