# Re-Test memory-journal-mcp — Code Mode: Team RBAC

Test team member management tools and role-based access limits through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.16 — ~7 test cases covering team RBAC operations via Code Mode.

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
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
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
