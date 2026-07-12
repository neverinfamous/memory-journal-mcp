# Re-Test memory-journal-mcp — Code Mode: Team CRUD & Search

Test team CRUD operations, error paths, and date range search through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.1–28.3 — ~15 test cases covering team create, read, search, and error paths via Code Mode.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Seed data S13–S14 are personal journal entries with `workspace_id: "test-ws"`, S15–S17 are team DB entries with `workspace_id: "test-ws"`.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 28: Team Tools via Code Mode

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured. If not configured, all team tools should return structured `{ success: false, error: "Team database not configured..." }`.
>
> **`team_delete_entry(workspace_id: "test-ws")` is soft-delete only** — no `permanent` flag.

### 28.1 Team CRUD

```javascript
// Test code:
const created = await mj.team.teamCreateEntry({
  workspace_id: "test-ws",
  content: 'CM4 team entry test',
  tags: ['codemode4-team-test'],
  entry_type: 'standup',
})
if (!created.success) return { createSuccess: false, error: created.error }

const withAuthor = await mj.team.teamCreateEntry({
  workspace_id: "test-ws",
  content: 'CM4 team explicit author',
  author: 'CM4Bot',
})
if (!withAuthor.success) return { explicitAuthorSuccess: false, error: withAuthor.error }

const recent = await mj.team.teamGetRecent({ workspace_id: "test-ws", limit: 5 })
const search = await mj.team.teamSearch({
  workspace_id: "test-ws",
  query: 'CM4 team entry test',
})
const tagSearch = await mj.team.teamSearch({
  workspace_id: "test-ws",
  tags: ['codemode4-team-test'],
})
const combined = await mj.team.teamSearch({
  workspace_id: "test-ws",
  query: 'team',
  tags: ['codemode4-team-test'],
})
const hybridAuto = await mj.team.teamSearch({
  workspace_id: "test-ws",
  query: 'how did we fix performance',
})
const forcedFts = await mj.team.teamSearch({
  workspace_id: "test-ws",
  query: 'CM4',
  mode: 'fts',
})
const noArgs = await mj.team.teamSearch({ workspace_id: "test-ws" })

const crossTeam = await mj.search.crossTeamSearch({ query: 'CM4 team' })
const crossTeamSpecific = await mj.search.crossTeamSearch({ query: 'CM4 team', team_dbs: ['primary'] })


// New: get by ID, list tags
const detail = await mj.team.teamGetEntryById({
  workspace_id: "test-ws",
  entry_id: created.entry.id,
})
const detailNoRels = await mj.team.teamGetEntryById({
  workspace_id: "test-ws",
  entry_id: created.entry.id,
  include_relationships: false,
})
const tags = await mj.team.teamListTags({ workspace_id: "test-ws" })

return {
  createSuccess: created.success,
  createAuthor: created.entry?.author,
  explicitAuthor: withAuthor.entry?.author,
  recentCount: recent.entries?.length ?? 0,
  recentHasAuthor: !!recent.entries?.[0]?.author,
  searchCount: search.entries?.length ?? 0,
  tagSearchCount: tagSearch.entries?.length ?? 0,
  combinedCount: combined.entries?.length ?? 0,
  hybridAutoCount: hybridAuto.entries?.length ?? 0,
  forcedFtsCount: forcedFts.entries?.length ?? 0,
  noArgsCount: noArgs.entries?.length ?? 0,
  crossTeamCount: crossTeam.entries?.length ?? 0,
  crossTeamSpecificCount: crossTeamSpecific.entries?.length ?? 0,

  detailHasEntry: !!detail.entry,
  detailHasImportance: !!detail.importance,
  detailNoRelsEmpty: !detailNoRels.relationships?.length,
  tagCount: tags.tags?.length ?? 0,
}
```

| Check                    | Expected                          |
| ------------------------ | --------------------------------- |
| `createSuccess`          | `true`                            |
| `createAuthor`           | Non-empty string (auto-populated) |
| `explicitAuthor`         | `"CM4Bot"`                        |
| `recentHasAuthor`        | `true`                            |
| `searchCount`            | ≥ 1                               |
| `tagSearchCount`         | ≥ 1                               |
| `hybridAutoCount`        | ≥ 0                               |
| `forcedFtsCount`         | ≥ 1                               |
| `crossTeamCount`         | ≥ 1                               |
| `crossTeamSpecificCount` | ≥ 1                               |

| `detailHasEntry`         | `true`                            |
| `tagCount`               | ≥ 1                               |


### 28.2 Team Error Paths

| Test               | Code                                                                                                                                                      | Expected Result                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Invalid entry_type | `return await mj.team.teamCreateEntry({ workspace_id: "test-ws", content: "test", entry_type: "invalid", workspace_id: "test-ws" });`                                 | `{ success: false, error: "..." }` |
| Nonexistent get    | `return await mj.team.teamGetEntryById({ workspace_id: "test-ws", entry_id: 999999, workspace_id: "test-ws" });`                                                      | `{ success: false, error: "..." }` |
| Nonexistent update | `return await mj.team.teamUpdateEntry({ workspace_id: "test-ws", entry_id: 999999, content: "x", workspace_id: "test-ws" });`                                         | `{ success: false, error: "..." }` |
| Nonexistent delete | `return await mj.team.teamDeleteEntry({ workspace_id: "test-ws", entry_id: 999999, workspace_id: "test-ws" });`                                                       | `{ success: false, error: "..." }` |
| Invalid date range | `return await mj.team.teamSearchByDateRange({ workspace_id: "test-ws", start_date: "Jan 1", end_date: "Jan 31", workspace_id: "test-ws" });`                          | `{ success: false, error: "..." }` |
| Merge same tag     | `return await mj.team.teamMergeTags({ source_tag: "x", target_tag: "x", workspace_id: "test-ws" });`                                                            | `{ success: false, error: "..." }` |
| Link nonexistent   | `return await mj.team.teamLinkEntries({ workspace_id: "test-ws", from_entry_id: 999999, to_entry_id: 1, relationship_type: "references", workspace_id: "test-ws" });` | `{ success: false, error: "..." }` |

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
