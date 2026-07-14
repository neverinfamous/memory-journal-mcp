# Re-Test memory-journal-mcp — Code Mode: Team CRUD & Search

Test team CRUD operations, error paths, and date range search through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28 (Part 2).1–28.3 — ~15 test cases covering team create, read, search, and error paths via Code Mode.

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

## Phase 28: Team Tools via Code Mode

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured. If not configured, all team tools should return structured `{ success: false, error: "Team database not configured..." }`.
>
> **`team_delete_entry(workspace_id: "test-ws")` is soft-delete only** — no `permanent` flag.

### 28.2 Team Error Paths

| Test               | Code                                                                                                                                                      | Expected Result                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Invalid type | `return await mj.team.teamCreateEntry({ workspace_id: "test-ws", content: "test", type: "invalid" });`                                 | `{ success: false, error: "..." }` |
| Nonexistent get    | `return await mj.team.teamGetEntryById({ workspace_id: "test-ws", id: 999999 });`                                                      | `{ success: false, error: "..." }` |
| Nonexistent update | `return await mj.team.teamUpdateEntry({ workspace_id: "test-ws", id: 999999, content: "x" });`                                         | `{ success: false, error: "..." }` |
| Nonexistent delete | `return await mj.team.teamDeleteEntry({ workspace_id: "test-ws", id: 999999 });`                                                       | `{ success: false, error: "..." }` |
| Invalid date range | `return await mj.team.teamSearchByDateRange({ workspace_id: "test-ws", fromDate: "Jan 1", toDate: "Jan 31" });`                          | `{ success: false, error: "..." }` |
| Merge same tag     | `return await mj.team.teamMergeTags({ source_tag: "x", target_tag: "x", workspace_id: "test-ws" });`                                                            | `{ success: false, error: "..." }` |
| Link nonexistent   | `return await mj.team.teamLinkEntries({ workspace_id: "test-ws", from_entry_id: 999999, to_entry_id: 1, relationship_type: "references" });` | `{ success: false, error: "..." }` |

### 28.3 Team Date Range Search

```javascript
// Test code:
const results = await mj.team.teamSearchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
})
if (!results.success) return { hasEntries: false, error: results.error }

const typed = await mj.team.teamSearchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
  type: 'standup',
})
if (!typed.success) return { typedFiltered: false, error: typed.error }

const tagged = await mj.team.teamSearchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
  tags: ['codemode4-team-test'],
})
if (!tagged.success) return { taggedCount: 0, error: tagged.error }


return {
  hasEntries: Array.isArray(results.entries),
  count: results.count ?? 0,
  typedFiltered: typed.entries?.every((e) => e.entryType === 'standup') ?? true,
  taggedCount: tagged.entries?.length ?? 0,

}
```

| Check                  | Expected                     |
| ---------------------- | ---------------------------- |
| `hasEntries`           | `true`                       |
| `typedFiltered`        | `true`                       |



---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `team_create_entry(workspace_id: "test-ws")` with auto-detected and explicit `author` works
- `team_get_recent(workspace_id: "test-ws")` returns entries with `author` field
- `team_search(workspace_id: "test-ws")` filters by text, tags, and combined
- `cross_team_search` successfully aggregates entries across databases
- `team_get_entry_by_id(workspace_id: "test-ws")` returns entry detail with `importance` and optional `relationships`
- `team_list_tags` returns tag list from team database
- `team_search_by_date_range(workspace_id: "test-ws")` filters by date range, type, and tags
- Invalid `type` on team create returns structured error
- Nonexistent IDs return structured errors for get, update, delete, link
- Invalid date range returns structured error with format hint
- Merge same tag returns structured error
