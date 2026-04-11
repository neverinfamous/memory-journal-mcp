# Re-Test memory-journal-mcp — GitHub Tool Group

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Scope:** Deterministic verification of the GitHub suite against the strict error handling matrix.

**Prerequisites:** Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

## 1. Structured Error Matrix

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

- [ ] Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- [ ] GitHub proxying safely catches 404s and 401s from the Octokit API.
- [ ] OutputSchemas are not broken by enriched error states.
