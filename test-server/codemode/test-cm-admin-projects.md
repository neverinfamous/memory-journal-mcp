# Re-Test memory-journal-mcp — Code Mode: Admin Projects

Test project CRUD operations via Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 27.2 — ~5 test cases.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `pnpm run check`.
3. Provide a very brief final summary including **Total Token Estimate**.

---

## Phase 27.2: Admin Projects via Code Mode

### Project CRUD

```javascript
// Test code:
// 1. Register project
const register = await mj.admin.registerProject({
  repo_name: 'test-codemode-project',
  metadata: { framework: 'react' }
})
const pNum = register.projectNumber

// 2. Get project
const getP = pNum ? await mj.admin.getProject({ name: pNum }) : null

// 3. Update project
let updateP = null
if (pNum) {
  updateP = await mj.admin.updateProject({
    name: pNum,
    metadata: { framework: 'nextjs' }
  })
}

// 4. List projects
const listP = await mj.admin.listProjects({})

// 5. Delete project
let deleteP = null
if (pNum) {
  deleteP = await mj.admin.deleteProject({ name: pNum })
}

return {
  registerSuccess: register.success,
  hasProjectNumber: !!pNum,
  getSuccess: getP?.success,
  updateSuccess: updateP?.success,
  listCount: listP.projects?.length > 0,
  deleteSuccess: deleteP?.success
}
```

| Check              | Expected |
| ------------------ | -------- |
| `registerSuccess`  | `true`   |
| `hasProjectNumber` | `true`   |
| `getSuccess`       | `true`   |
| `updateSuccess`    | `true`   |
| `listCount`        | `true`   |
| `deleteSuccess`    | `true`   |

---

## Success Criteria

- `register_project` correctly creates a project and returns its number
- `get_project` successfully retrieves the new project
- `update_project` updates project metadata
- `list_projects` returns a list of projects
- `delete_project` successfully deletes the project
