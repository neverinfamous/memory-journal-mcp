# Re-Test memory-journal-mcp — Team RBAC (Phase 14.5)

**Scope:** 5 team member management tools (`team_add_member`, `team_list_members`, `team_update_member_role`, `team_remove_member`, `team_get_member`).

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 14.5: Team Member Management & RBAC

| Test | Command/Action | Expected Result |
|---|---|---|
| Add Member | `team_add_member(author: "test_viewer", role: "viewer")` | `success: true`, returns member details including `role: "viewer"` |
| Add Duplicate | `team_add_member(author: "test_viewer", role: "member")` | Structured error: Member already exists |
| Get Member | `team_get_member(author: "test_viewer")` | Returns member details with `role: "viewer"` |
| Update Role | `team_update_member_role(author: "test_viewer", role: "member")` | `success: true`, role updated to `member` |
| List Members | `team_list_members` | Array includes `test_viewer` |
| Remove Member | `team_remove_member(author: "test_viewer")` | `success: true` |
| Get Nonexistent | `team_get_member(author: "test_viewer")` | Structured error: Member not found |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `team_add_member` successfully adds a member with the specified role.
- `team_add_member` rejects duplicate usernames with a structured error.
- `team_get_member` retrieves the correct member details.
- `team_update_member_role` successfully changes an existing member's role.
- `team_list_members` includes the newly added member in the output array.
- `team_remove_member` permanently deletes the member from the database.
- `team_get_member` returns a structured `RESOURCE_NOT_FOUND` error for nonexistent users.
