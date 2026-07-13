
# Re-Test memory-journal-mcp — Team Admin & Recovery

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---


### 14.7 Team Admin & Recovery

| Test                     | Command/Action                                                                          | Expected Result                                      |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Update content           | `team_update_entry(workspace_id: "test-ws", entry_id: <id>, content: "Updated team content")` | `success: true`, `entry` with updated content        |
| Update omit project_no   | `team_update_entry(entry_id: <id>, content: "Updated without project number parameter")` | `success: true` (falls back to existing project number)|
| Update tags              | `team_update_entry(workspace_id: "test-ws", entry_id: <id>, tags: ["updated-team"])`          | Tags changed on team entry                           |

| Update entry_type        | `team_update_entry(workspace_id: "test-ws", entry_id: <id>, entry_type: "technical_note")`    | Entry type changed                                   |
| Update is_archived       | `team_update_entry(workspace_id: "test-ws", entry_id: <id>, is_archived: true)`               | Entry is archived                                    |
| Update with version      | `team_update_entry(workspace_id: "test-ws", entry_id: <id>, expected_version: <v>, content: "V2")`| `success: true`, version increments                  |
| Update conflict          | `team_update_entry(workspace_id: "test-ws", entry_id: <id>, expected_version: <stale_v>, content: "V3")`| Structured error with `VERSION_CONFLICT` code       |
| Update nonexistent       | `team_update_entry(workspace_id: "test-ws", entry_id: 999999, content: "x")`                  | Structured error: `{ success: false, error: "..." }` |
| Soft delete              | `team_delete_entry(workspace_id: "test-ws", entry_id: <id>)`                                  | `success: true`, `message` confirming deletion       |
| List deleted entries     | `team_list_deleted_entries(workspace_id: "test-ws")`                                          | Returns soft-deleted entry in the list               |
| Restore entry            | `team_restore_entry(workspace_id: "test-ws", entry_id: <id>)`                                 | `success: true`, entry is restored (`is_deleted = 0`)|
| Restore nonexistent      | `team_restore_entry(workspace_id: "test-ws", entry_id: 999999)`                               | Structured error: `{ success: false, error: "..." }` |
| Delete nonexistent       | `team_delete_entry(workspace_id: "test-ws", entry_id: 999999)`                                | Structured error: `{ success: false, error: "..." }` |
| Merge tags               | `team_merge_tags(workspace_id: "test-ws", source_tag: "team-old", target_tag: "team-new")`    | `success: true`, `entriesUpdated`, `sourceDeleted`   |
| Merge same tag           | `team_merge_tags(workspace_id: "test-ws", source_tag: "team-new", target_tag: "team-new")`    | Structured error: `{ success: false, error: "..." }` |
| Merge nonexistent source | `team_merge_tags(workspace_id: "test-ws", source_tag: "nonexistent-xyz", target_tag: "x")`    | Structured error: `{ success: false, error: "..." }` |

### 14.16 Cleanup

| Test        | Command/Action                                                        | Expected Result                 |
|

---

