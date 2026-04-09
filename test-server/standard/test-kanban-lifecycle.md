# Test memory-journal-mcp — Kanban Lifecycle

**Scope:** Tests the new Kanban tools `add_kanban_item` and `delete_kanban_item`, along with `move_kanban_item` and the optimized `get_kanban_board` to verify full lifecycle awareness and control.

**Execution Strategy:** Use direct MCP tools. Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:**

- A designated GitHub issue to act as the test subject (e.g. Issue #385 or similar).
- Identify the repository and `project_number`.
- You must use direct `add_kanban_item` using the issue's number.

**Workflow after testing:**

1. Verify token usage limit adherence in the final summary.

---

## 13.5.1 Board Discovery

| #   | Test                                       | Command                                | Expected Result                                                                                                   |
| --- | ------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Diagnose columns without pulling full body | `get_kanban_board(summary_only: true)` | Returns columns with `itemCount` and `itemDirectory` populated, while `items: []` is stripped to preserve tokens. |

### Verification Checks

- [ ] `summaryOnly: true` is present.
- [ ] `itemDirectory` contains an ID, Title, and Status for topological mapping.

## 13.5.2 Lifecycle: Add -> Move -> Delete

| #   | Test                           | Command                                                           | Expected Result                                                          |
| --- | ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 2   | Link existing issue to Project | `add_kanban_item(issue_number: <#>)`                              | Success, returns `itemId` indicating it is tethered to the board.        |
| 3   | Move issue to target status    | `move_kanban_item(item_id: "<ID>", target_status: "In Progress")` | Success moving to "In Progress".                                         |
| 4   | Untether item from Project     | `delete_kanban_item(item_id: "<ID>")`                             | Success, removes from Kanban column without closing the actual Issue/PR. |

### Verification Checks

- [ ] `add_kanban_item` strictly utilizes integer `issue_number` seamlessly resolving it to `nodeId`.
- [ ] Item moves dynamically to non-default column natively.
- [ ] `delete_kanban_item` explicitly purges from topological board representation smoothly.

---

## Success Criteria

- [ ] Complete Add -> Move -> Remove pipeline succeeds consecutively.
- [ ] Token count optimized through `itemDirectory` vs traditional bloated pagination.
- [ ] Ensure the issue survives the `delete_kanban_item` mutation (check state `get_github_issue(issue_number: <#>)` is NOT closed).
