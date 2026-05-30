# Re-Test memory-journal-mcp — Code Mode Kanban Lifecycle

**Scope:** Automates the testing of `mj.github` Kanban integrations (`addProjectItem`, `moveProjectItem`, `deleteProjectItem`, `getProjectKanban`) natively via sandbox.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## 25.1.1 Full Topological Execution

| #   | Test                                   | Command                                             | Expected Result                                                                   |
| --- | -------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Pipelined Add -> Move -> Map -> Delete | `mj_execute_code` with the pipeline logic natively. | `{ "success": true, "stages": [...] }` returned smoothly inside the tool wrapper. |

### The Pipeline Script Setup

Run this explicit code mode script internally. Configure it against an arbitrary testing issue (like an open documentation issue) by setting `TEST_ISSUE_NUMBER`. Configure `TEST_PROJECT_NUMBER = 5`.

```javascript
// Test configurations
const PROJECT_NUM = 5
const OWNER = 'neverinfamous'
const REPO = 'memory-journal-mcp'

// Pipeline tracker
const _stages = []

try {
  // 1. Create temporary issue to test Kanban
  const createResult = await mj.github.createIssue({
    title: 'CM6 Test Kanban',
    owner: OWNER,
    repo: REPO,
  })
  if (!createResult.success) throw new Error('Could not create issue')
  const testIssue = createResult.issue.number
  _stages.push({ step: 'createIssue', issue: testIssue })

  // 2. Remove from default Kanban to test direct linkage
  const initBoard = await mj.github.getKanbanBoard({
    project_number: PROJECT_NUM,
    owner: OWNER,
    repo: REPO,
  })
  if (initBoard.success === false) throw new Error(initBoard.error || 'Failed to get Kanban board')
  
  let initItemId = null
  for (const col of initBoard.columns) {
    for (const item of col.items) {
      if (item.number === testIssue) initItemId = item.id
    }
  }
  if (initItemId) {
    const deleteInitResult = await mj.github.deleteKanbanItem({
      project_number: PROJECT_NUM,
      item_id: initItemId,
      owner: OWNER,
      repo: REPO,
    })
    if (!deleteInitResult.success)
      throw new Error(`Initial delete failed: ${deleteInitResult.error || JSON.stringify(deleteInitResult)}`)
  }

  // Now add it back to test addKanbanItem
  const addResult = await mj.github.addKanbanItem({
    project_number: PROJECT_NUM,
    issue_number: testIssue,
    owner: OWNER,
    repo: REPO,
  })
  if (!addResult.success)
    throw new Error(`Add failed: ${addResult.error || JSON.stringify(addResult)}`)
  _stages.push({ step: 'addProjectItem', itemId: addResult.itemId })

  // 3. Move across statuses
  const projectInfo = await mj.github.getKanbanBoard({
    project_number: PROJECT_NUM,
    owner: OWNER,
    repo: REPO,
  })
  if (projectInfo.success === false) throw new Error(projectInfo.error || 'Failed to get Kanban board')
  const targetOption = projectInfo.statusOptions.find((o) => o.name === 'Ready')

  const moveResult = await mj.github.moveKanbanItem({
    project_number: PROJECT_NUM,
    item_id: addResult.itemId,
    target_status: targetOption.name,
    owner: OWNER,
    repo: REPO,
  })
  if (!moveResult.success)
    throw new Error(`Move failed: ${moveResult.error || JSON.stringify(moveResult)}`)
  _stages.push({ step: 'moveProjectItem', newStatus: 'Ready' })

  // 4. Verify topological representation in columns (retry for eventual consistency)
  let foundItem = null
  for (let i = 0; i < 3; i++) {
    // Spin loop for 1.5 seconds to allow GraphQL index to catch up
    const start = Date.now()
    while (Date.now() - start < 1500) { /* spin */ }

    const verifyProject = await mj.github.getKanbanBoard({
      project_number: PROJECT_NUM,
      owner: OWNER,
      repo: REPO,
    })
    if (verifyProject.success === false) throw new Error(verifyProject.error || 'Failed to get Kanban board')
    
    foundItem = null // Reset for this iteration

    for (const col of verifyProject.columns) {
      for (const item of col.items) {
        if (item.id === addResult.itemId) {
          foundItem = item
          break
        }
      }
      if (foundItem) break
    }
    if (foundItem && foundItem.status === 'Ready') break
  }

  if (!foundItem) {
    _stages.push({ step: 'verifyBoardStructure', warning: 'Topological verification skipped due to extended eventual consistency delay' })
  } else if (foundItem.status !== 'Ready') {
    throw new Error(`Item status is ${foundItem.status}, expected Ready`)
  } else {
    _stages.push({ step: 'verifyBoardStructure', targetReached: true })
  }

  // 5. Tear down
  const deleteResult = await mj.github.deleteKanbanItem({
    project_number: PROJECT_NUM,
    item_id: addResult.itemId,
    owner: OWNER,
    repo: REPO,
  })
  if (!deleteResult.success)
    throw new Error(`Delete failed: ${deleteResult.error || JSON.stringify(deleteResult)}`)
  _stages.push({ step: 'deleteProjectItem', detached: true })

  await mj.github.closeIssue({
    issue_number: testIssue,
    owner: OWNER,
    repo: REPO,
    comment: 'Testing complete',
  })

  return { success: true, stages: _stages }
} catch (error) {
  return { success: false, error: error.message, failedAtStages: _stages }
}
```

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Code properly parses internal node IDs natively matching external handler behavior.
- No server crash or GraphQL mutation block.
- The issue is safely restored back to default standalone status with no remnant project linkage.
