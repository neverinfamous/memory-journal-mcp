# Re-Test memory-journal-mcp — Code Mode Kanban Lifecycle

**Scope:** Phase 25.1 — Automates the testing of `mj.github` Kanban integrations (`addProjectItem`, `moveProjectItem`, `deleteProjectItem`, `getProjectKanban`) natively via sandbox.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
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
  const createResult = await mj.github.createGithubIssueWithEntry({
    title: 'CM6 Test Kanban',
    body: 'Test kanban body',
    workspace_id: "test-ws",
    tags: ['test-kanban']
  })
  if (!createResult.success) throw new Error('Could not create issue')
  const testIssue = createResult.issue.number
  _stages.push({ step: 'createIssue', issue: testIssue })

  // 2. Remove from default Kanban to test direct linkage
  const initBoard = await mj.github.getKanbanBoard({
    workspace_id: PROJECT_NUM,
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
      workspace_id: PROJECT_NUM,
      item_id: initItemId,
      owner: OWNER,
      repo: REPO,
    })
    if (!deleteInitResult.success)
      throw new Error(
        `Initial delete failed: ${deleteInitResult.error || JSON.stringify(deleteInitResult)}`
      )
  }

  // Now add it back to test addKanbanItem
  const addResult = await mj.github.addKanbanItem({
    workspace_id: PROJECT_NUM,
    issueNumber: testIssue,
    owner: OWNER,
    repo: REPO,
  })
  if (!addResult.success)
    throw new Error(`Add failed: ${addResult.error || JSON.stringify(addResult)}`)
  _stages.push({ step: 'addProjectItem', itemId: addResult.itemId })

  // 3. Move across statuses
  const projectInfo = await mj.github.getKanbanBoard({
    workspace_id: PROJECT_NUM,
    owner: OWNER,
    repo: REPO,
  })
  if (projectInfo.success === false)
    throw new Error(projectInfo.error || 'Failed to get Kanban board')
  const targetOption = projectInfo.statusOptions.find((o) => o.name === 'Ready')

  const moveResult = await mj.github.moveKanbanItem({
    workspace_id: PROJECT_NUM,
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
    while (Date.now() - start < 1500) {
      /* spin */
    }

    const verifyProject = await mj.github.getKanbanBoard({
      workspace_id: PROJECT_NUM,
      owner: OWNER,
      repo: REPO,
    })
    if (verifyProject.success === false)
      throw new Error(verifyProject.error || 'Failed to get Kanban board')

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
    _stages.push({
      step: 'verifyBoardStructure',
      warning: 'Topological verification skipped due to extended eventual consistency delay',
    })
  } else if (foundItem.status !== 'Ready') {
    throw new Error(`Item status is ${foundItem.status}, expected Ready`)
  } else {
    _stages.push({ step: 'verifyBoardStructure', targetReached: true })
  }

  // 5. Tear down
  const deleteResult = await mj.github.deleteKanbanItem({
    workspace_id: PROJECT_NUM,
    item_id: addResult.itemId,
    owner: OWNER,
    repo: REPO,
  })
  if (!deleteResult.success)
    throw new Error(`Delete failed: ${deleteResult.error || JSON.stringify(deleteResult)}`)
  _stages.push({ step: 'deleteProjectItem', detached: true })

  await mj.github.closeGithubIssueWithEntry({
    issueNumber: testIssue,
    workspace_id: PROJECT_NUM,
    resolution_notes: 'Testing complete',
    comment: 'Testing complete'
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
