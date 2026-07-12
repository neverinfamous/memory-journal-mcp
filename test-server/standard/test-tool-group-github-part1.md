# Re-Test memory-journal-mcp — GitHub Tool Group

**Scope:** Deterministic verification of the GitHub suite (`get_github_issues`, `get_github_prs`, `get_github_issue`, `get_github_pr`, `get_github_context`, `get_kanban_board`, `move_kanban_item`, `add_kanban_item`, `delete_kanban_item`, `create_github_issue_with_entry`, `close_github_issue_with_entry`, `get_github_milestones`, `get_github_milestone`, `create_github_milestone`, `update_github_milestone`, `delete_github_milestone`, `get_repo_insights`, `get_copilot_reviews`) against the strict error handling matrix.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## 1. Zod Boundary & Type Mismatch Matrix

| Tool                            | Domain Error Test                                    | Zod Empty Param (`{}`)                                  |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `get_github_issues`             | Repo not found                                       | Should succeed (defaults if auto-context exists)        |
| `get_github_prs`                | Repo not found                                       | Should succeed (defaults if auto-context exists)        |
| `get_github_issue`              | `issue_number: 999999` -> Not found structural error | ⚠️ Should return validation error                       |
| `get_github_pr`                 | `pr_number: 999999` -> Not found structural error    | ⚠️ Should return validation error                       |
| `get_github_context`            | N/A                                                  | Should succeed                                          |
| `get_kanban_board`              | `project_number: 999999` -> Not found                | ⚠️ Returns CONFIGURATION_ERROR (auto-detect precedence) |
| `move_kanban_item`              | `target_status: "Nonexistent"`                       | ⚠️ Should return validation error                       |
| `add_kanban_item`               | `content_id: 999999` -> Not found                    | ⚠️ Should return validation error                       |
| `delete_kanban_item`            | `item_id: 999999` -> Not found                       | ⚠️ Should return validation error                       |
| `create_github_issue_with_entry`| Invalid parameters                                   | ⚠️ Should return validation error                       |

### Specific Domain Checks

- **OutputSchema Compliance**: ⚠️ For `move_kanban_item(Bad Status)`, the error response returns `availableStatuses`. Verify this extra metadata doesn't cause a `-32602` OutputSchema validation error when `strict` is active.
- **OutputSchema Compliance**: `get_repo_insights(sections: "traffic")` - verify partial failures do not leak unrecognized fields.

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- GitHub proxying safely catches 404s and 401s from the Octokit API.
- OutputSchemas are not broken by enriched error states.
