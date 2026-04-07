# Test memory-journal-mcp — GitHub Tool Group

**Execution Strategy:** The agent is to use direct MCP tools whenever possible rather than Code Mode or scripts. Code Mode is preferred to scripts.

**Scope:** Deterministic verification of the GitHub suite against the strict error handling matrix.

## 1. Structured Error Matrix

| Tool | Domain Error Test | Zod Empty Param (`{}`) |
|---|---|---|
| `get_github_issue` | `issue_number: 999999` -> Not found structural error | ⚠️ Should return validation error |
| `get_github_pr` | `pr_number: 999999` -> Not found structural error | ⚠️ Should return validation error |
| `get_github_milestone` | `milestone_number: 999999` -> Not found error | ⚠️ Should return validation error |
| `close_github_issue_with_entry` | Close already closed issue | ⚠️ Should return validation error |
| `get_kanban_board` | `project_number: 999999` -> Not found | ⚠️ Should return validation error |
| `move_kanban_item` | `target_status: "Nonexistent"` | ⚠️ Should return validation error |

### Specific Domain Checks

- **OutputSchema Compliance**: ⚠️ For `move_kanban_item(Bad Status)`, the error response returns `availableStatuses`. Verify this extra metadata doesn't cause a `-32602` OutputSchema validation error when `strict` is active.
- **OutputSchema Compliance**: `get_repo_insights(sections: "traffic")` - verify partial failures do not leak unrecognized fields.

## Success Criteria
- [x] Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- [x] GitHub proxying safely catches 404s and 401s from the Octokit API.
- [x] OutputSchemas are not broken by enriched error states.
