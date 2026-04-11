# Test memory-journal-mcp — Code Mode Kanban Lifecycle

**Scope:** Automates the testing of `mj.github` Kanban integrations (`addProjectItem`, `moveProjectItem`, `deleteProjectItem`, `getProjectKanban`) natively via sandbox.

**Execution:** Use ONLY the Code Mode Sandbox (`mj_execute_code`).
Extract and report the `_meta.tokenEstimate` from the tool's outer response wrapper to guarantee performance logging. Do not try to reference `_meta` inside the Javascript code itself.

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

// Pipeline tracker
const _stages = []

try {
  // 1. Create temporary issue to test Kanban
  const createResult = await mj.github.createIssue({
    title: 'CM6 Test Kanban',
    owner: 'neverinfamous',
    repo: 'memory-journal-mcp',
  })
  if (!createResult.success) throw new Error('Could not create issue')
  const testIssue = createResult.issue.number
  _stages.push({ step: 'createIssue', issue: testIssue })

  // 2. Remove from default Kanban to test direct linkage
  const initBoard = await mj.github.getKanbanBoard({ project_number: PROJECT_NUM })
  let initItemId = null
  for (const col of initBoard.columns) {
    for (const item of col.items) {
      if (item.number === testIssue) initItemId = item.id
    }
  }
  if (initItemId)
    await mj.github.deleteKanbanItem({ project_number: PROJECT_NUM, item_id: initItemId })

  // Now add it back to test addKanbanItem
  const addResult = await mj.github.addKanbanItem({
    project_number: PROJECT_NUM,
    issue_number: testIssue,
    owner: 'neverinfamous',
    repo: 'memory-journal-mcp',
  })
  if (!addResult.success)
    throw new Error(`Add failed: ${addResult.error || JSON.stringify(addResult)}`)
  _stages.push({ step: 'addProjectItem', itemId: addResult.itemId })

  // 3. Move across statuses
  const projectInfo = await mj.github.getKanbanBoard({ project_number: PROJECT_NUM })
  const targetOption = projectInfo.statusOptions.find((o) => o.name === 'Ready')

  const moveResult = await mj.github.moveKanbanItem({
    project_number: PROJECT_NUM,
    item_id: addResult.itemId,
    target_status: targetOption.name,
  })
  if (!moveResult.success)
    throw new Error(`Move failed: ${moveResult.error || JSON.stringify(moveResult)}`)
  _stages.push({ step: 'moveProjectItem', newStatus: 'Ready' })

  // 4. Verify topological representation in columns (retry for eventual consistency)
  let foundItem = null
  for (let i = 0; i < 3; i++) {
    const verifyProject = await mj.github.getKanbanBoard({ project_number: PROJECT_NUM })
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

  if (!foundItem) throw new Error('Item not found in project columns after move')
  if (foundItem.status !== 'Ready')
    throw new Error(`Item status is ${foundItem.status}, expected Ready`)
  _stages.push({ step: 'verifyBoardStructure', targetReached: true })

  // 5. Tear down
  const deleteResult = await mj.github.deleteKanbanItem({
    project_number: PROJECT_NUM,
    item_id: addResult.itemId,
  })
  if (!deleteResult.success)
    throw new Error(`Delete failed: ${deleteResult.error || JSON.stringify(deleteResult)}`)
  _stages.push({ step: 'deleteProjectItem', detached: true })

  await mj.github.closeIssue({
    issue_number: testIssue,
    owner: 'neverinfamous',
    repo: 'memory-journal-mcp',
    comment: 'Testing complete',
  })

  return { success: true, stages: _stages }
} catch (error) {
  return { success: false, error: error.message, failedAtStages: _stages }
}
```

### Verification Checks

- [ ] Code properly parses internal node IDs natively matching external handler behavior.
- [ ] No server crash or GraphQL mutation block.
- [ ] The issue is safely restored back to default standalone status with no remnant project linkage.
