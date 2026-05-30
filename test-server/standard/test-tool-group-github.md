# Re-Test memory-journal-mcp — GitHub Tool Group

**Scope:** Deterministic verification of the GitHub suite against the strict error handling matrix.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## 1. Zod Boundary & Type Mismatch Matrix

| Tool                            | Domain Error Test                                    | Zod Empty Param (`{}`)            |
| ------------------------------- | ---------------------------------------------------- | --------------------------------- |
| `get_github_issue`              | `issue_number: 999999` -> Not found structural error | ⚠️ Should return validation error |
| `get_github_pr`                 | `pr_number: 999999` -> Not found structural error    | ⚠️ Should return validation error |
| `get_github_milestone`          | `milestone_number: 999999` -> Not found error        | ⚠️ Should return validation error |
| `close_github_issue_with_entry` | Close already closed issue                           | ⚠️ Should return validation error |
| `get_kanban_board`              | `project_number: 999999` -> Not found                | ⚠️ Should return validation error |
| `move_kanban_item`              | `target_status: "Nonexistent"`                       | ⚠️ Should return validation error |

### Specific Domain Checks

- **OutputSchema Compliance**: ⚠️ For `move_kanban_item(Bad Status)`, the error response returns `availableStatuses`. Verify this extra metadata doesn't cause a `-32602` OutputSchema validation error when `strict` is active.
- **OutputSchema Compliance**: `get_repo_insights(sections: "traffic")` - verify partial failures do not leak unrecognized fields.

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- GitHub proxying safely catches 404s and 401s from the Octokit API.
- OutputSchemas are not broken by enriched error states.
