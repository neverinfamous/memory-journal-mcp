# Re-Test memory-journal-mcp — Code Mode: Team RBAC

Test team member management tools and role-based access limits through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.16 — ~7 test cases covering team RBAC operations via Code Mode.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- You MUST ensure `CODEMODE_INTERNAL_FULL_ACCESS: "true"` is set in your environment/config OR your user is already bootstrapped as an admin. Otherwise, Code Mode scripts will receive `PERMISSION_DENIED` errors when trying to manage members.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then stop so the USER can verify.
3. Clean up any test artifacts generated.
4. Provide a very brief final summary including the **Total Token Estimate**.

---

## Phase 28: Team RBAC via Code Mode

### 28.16 Team Member Management

```javascript
// Test code:
const added = await mj.team.teamAddMember({
  author: 'cm_test_viewer',
  role: 'viewer'
})
if (!added.success) return { success: false, error: added.error, code: added.code };

let duplicateCaught = false;
const dup = await mj.team.teamAddMember({
  author: 'cm_test_viewer',
  role: 'member'
})
if (dup.success === false && dup.error) {
  duplicateCaught = true;
}

const getMem = await mj.team.teamGetMember({
  author: 'cm_test_viewer'
})
if (!getMem.success) return { success: false, error: getMem.error, code: getMem.code };

const updated = await mj.team.teamUpdateMemberRole({
  author: 'cm_test_viewer',
  role: 'member'
})
if (!updated.success) return { success: false, error: updated.error, code: updated.code };

const listMem = await mj.team.teamListMembers({})
if (!listMem.success) return { success: false, error: listMem.error, code: listMem.code };

const removed = await mj.team.teamRemoveMember({
  author: 'cm_test_viewer'
})
if (!removed.success) return { success: false, error: removed.error, code: removed.code };

let notFoundCaught = false;
const nf = await mj.team.teamGetMember({
  author: 'cm_test_viewer'
})
if (nf.success === false && nf.error) {
  notFoundCaught = true;
}

return {
  addSuccess: added.success,
  addedRole: added.member?.role === 'viewer',
  duplicateCaught,
  getSuccess: getMem.success,
  updateSuccess: updated.success,
  updatedRole: updated.member?.role === 'member',
  listHasMember: listMem.members?.some(m => m.author === 'cm_test_viewer'),
  removeSuccess: removed.success,
  notFoundCaught
}
```

| Check             | Expected |
| ----------------- | -------- |
| `addSuccess`      | `true`   |
| `addedRole`       | `true`   |
| `duplicateCaught` | `true`   |
| `getSuccess`      | `true`   |
| `updateSuccess`   | `true`   |
| `updatedRole`     | `true`   |
| `listHasMember`   | `true`   |
| `removeSuccess`   | `true`   |
| `notFoundCaught`  | `true`   |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `mj.team.teamAddMember` successfully adds a member with the given role.
- `mj.team.teamAddMember` rejects duplicate usernames by throwing an error.
- `mj.team.teamGetMember` retrieves the correct member details.
- `mj.team.teamUpdateMemberRole` successfully changes an existing member's role.
- `mj.team.teamListMembers` includes the newly added member in the output array.
- `mj.team.teamRemoveMember` permanently deletes the member from the database.
- `mj.team.teamGetMember` rejects nonexistent usernames by throwing an error.
