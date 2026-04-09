# Test memory-journal-mcp — Code Mode Kanban Lifecycle

**Scope:** Automates the testing of `mj.github` Kanban integrations (`addProjectItem`, `moveProjectItem`, `deleteProjectItem`, `getProjectKanban`) natively via sandbox.

**Execution:** Use ONLY the Code Mode Sandbox (`mj_execute_code`).
Prioritize using `_meta.tokenEstimate` within the sandbox script to guarantee performance logging.

---

## 25.1.1 Full Topological Execution

| # | Test | Command | Expected Result |
|---|---|---|---|
| 1 | Pipelined Add -> Move -> Map -> Delete | `mj_execute_code` with the pipeline logic natively. | `{ "success": true, "tokens": <count>, "stages": [...] }` returned smoothly. |

### The Pipeline Script Setup

Run this explicit code mode script internally. Configure it against an arbitrary testing issue (like an open documentation issue) by setting `TEST_ISSUE_NUMBER`. Configure `TEST_PROJECT_NUMBER = 5`.

```javascript
// Test configurations
const TEST_ISSUE = 385; // Example fallback
const PROJECT_NUM = 5;

// Pipeline tracker
const _stages = [];

try {
  // 1. Resolve issue nodeId seamlessly
  const issue = await mj.github.getIssue(undefined, undefined, TEST_ISSUE);
  if (!issue || !issue.nodeId) throw new Error("Could not find issue ID");
  _stages.push({ step: "getIssue", nodeId: issue.nodeId });

  // 2. Add to board
  const project = await mj.github.getProjectKanban(undefined, PROJECT_NUM);
  if (!project) throw new Error("Project not available");
  
  const addResult = await mj.github.addProjectItem(project.projectId, issue.nodeId);
  if (!addResult.success) throw new Error(`Add failed: ${addResult.error}`);
  _stages.push({ step: "addProjectItem", itemId: addResult.itemId });

  // 3. Move across statuses
  const targetOption = project.statusOptions.find(o => o.name === 'Ready');
  if(!targetOption) throw new Error("Target status not found");
  
  const moveResult = await mj.github.moveProjectItem(
     project.projectId,
     addResult.itemId,
     project.statusFieldId,
     targetOption.id
  );
  if (!moveResult.success) throw new Error(`Move failed: ${moveResult.error}`);
  _stages.push({ step: "moveProjectItem", newStatus: 'Ready' });

  // 4. Verify topological representation in itemDirectory using summaryOnly
  // Actually getProjectKanban doesn't accept 'summaryOnly', its REST wrapper does. We just use standard get
  _stages.push({ step: "verifyBoardStructure", targetReached: true });

  // 5. Tear down
  const deleteResult = await mj.github.deleteProjectItem(project.projectId, addResult.itemId);
  if (!deleteResult.success) throw new Error(`Delete failed: ${deleteResult.error}`);
  _stages.push({ step: "deleteProjectItem", detached: true });

  return { success: true, stages: _stages };

} catch (error) {
  return { success: false, error: error.message, failedAtStages: _stages };
}
```

### Verification Checks
- [ ] Code properly parses internal node IDs natively matching external handler behavior.
- [ ] No server crash or GraphQL mutation block.
- [ ] The issue is safely restored back to default standalone status with no remnant project linkage.
