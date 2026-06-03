# Re-Test memory-journal-mcp — Team RBAC (Phase 14.5)

**Scope:** 5 team member management tools (`team_add_member`, `team_list_members`, `team_update_member_role`, `team_remove_member`, `team_get_member`).

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests.
- Seed data from `test-seed.md` must be present.
- `TEAM_DB_PATH` configured. 
- You MUST ensure the server was booted with your author name registered as an admin (e.g. via `--team-admin`), otherwise member management tools will reject your requests with `PERMISSION_DENIED`.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then stop so the USER can verify.
3. Clean up any test artifacts generated.
4. Provide a very brief final summary including the **Total Token Estimate**.

---

## Phase 14.5: Team Member Management & RBAC

| Test | Command/Action | Expected Result |
|---|---|---|
| Add Member | `team_add_member(username: "test_viewer", role: "viewer")` | `success: true`, returns member details including `role: "viewer"` |
| Add Duplicate | `team_add_member(username: "test_viewer", role: "member")` | Structured error: Member already exists |
| Get Member | `team_get_member(username: "test_viewer")` | Returns member details with `role: "viewer"` |
| Update Role | `team_update_member_role(username: "test_viewer", role: "member")` | `success: true`, role updated to `member` |
| List Members | `team_list_members` | Array includes `test_viewer` |
| Remove Member | `team_remove_member(username: "test_viewer")` | `success: true` |
| Get Nonexistent | `team_get_member(username: "test_viewer")` | Structured error: Member not found |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `team_add_member` successfully adds a member with the specified role.
- `team_add_member` rejects duplicate usernames with a structured error.
- `team_get_member` retrieves the correct member details.
- `team_update_member_role` successfully changes an existing member's role.
- `team_list_members` includes the newly added member in the output array.
- `team_remove_member` permanently deletes the member from the database.
- `team_get_member` returns a structured `RESOURCE_NOT_FOUND` error for nonexistent users.
