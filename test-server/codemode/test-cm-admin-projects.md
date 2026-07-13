# Re-Test memory-journal-mcp — Code Mode: Admin Projects

Test project CRUD operations via Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 27.2 — ~5 test cases.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
3. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
3. Provide a very brief final summary including **Total Token Estimate**.

---

## Phase 27.2: Admin Projects via Code Mode

### Project CRUD

```javascript
// Test code:
// 1. Register project
const register = await mj.admin.registerProject({
  name: 'test-codemode-project',
  metadata: { framework: 'react' }
})
const pNum = register.project?.name

// 2. Get project
const getP = pNum ? await mj.admin.getProject({ name: pNum }) : null

// 3. Update project
let updateP = null
if (pNum) {
  updateP = await mj.admin.updateProject({
    name: pNum,
    absolute_path: '/tmp/test-codemode-project-v2'
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
