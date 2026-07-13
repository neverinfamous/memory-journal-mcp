# Re-Test memory-journal-mcp — Code Mode: Team CRUD & Search

Test team CRUD operations, error paths, and date range search through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28 (Part 2).1–28.3 — ~15 test cases covering team create, read, search, and error paths via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Seed data S13–S14 are personal journal entries with `workspace_id: "test-ws"`, S15–S17 are team DB entries with `workspace_id: "test-ws"`.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun .\\.agents\\scripts\\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
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
| Invalid entry_type | `return await mj.team.teamCreateEntry({ workspace_id: "test-ws", content: "test", entry_type: "invalid" });`                                 | `{ success: false, error: "..." }` |
| Nonexistent get    | `return await mj.team.teamGetEntryById({ workspace_id: "test-ws", entry_id: 999999 });`                                                      | `{ success: false, error: "..." }` |
| Nonexistent update | `return await mj.team.teamUpdateEntry({ workspace_id: "test-ws", entry_id: 999999, content: "x" });`                                         | `{ success: false, error: "..." }` |
| Nonexistent delete | `return await mj.team.teamDeleteEntry({ workspace_id: "test-ws", entry_id: 999999 });`                                                       | `{ success: false, error: "..." }` |
| Invalid date range | `return await mj.team.teamSearchByDateRange({ workspace_id: "test-ws", start_date: "Jan 1", end_date: "Jan 31" });`                          | `{ success: false, error: "..." }` |
| Merge same tag     | `return await mj.team.teamMergeTags({ source_tag: "x", target_tag: "x", workspace_id: "test-ws" });`                                                            | `{ success: false, error: "..." }` |
| Link nonexistent   | `return await mj.team.teamLinkEntries({ workspace_id: "test-ws", from_entry_id: 999999, to_entry_id: 1, relationship_type: "references" });` | `{ success: false, error: "..." }` |

### 28.3 Team Date Range Search

```javascript
// Test code:
const results = await mj.team.teamSearchByDateRange({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: '2026-12-31',
})
if (!results.success) return { hasEntries: false, error: results.error }

const typed = await mj.team.teamSearchByDateRange({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  entry_type: 'standup',
})
if (!typed.success) return { typedFiltered: false, error: typed.error }

const tagged = await mj.team.teamSearchByDateRange({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: '2026-12-31',
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
- `team_search_by_date_range(workspace_id: "test-ws")` filters by date range, entry_type, and tags
- Invalid `entry_type` on team create returns structured error
- Nonexistent IDs return structured errors for get, update, delete, link
- Invalid date range returns structured error with format hint
- Merge same tag returns structured error
