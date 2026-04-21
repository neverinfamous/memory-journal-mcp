# Re-Test memory-journal-mcp — Code Mode: Team CRUD & Search

Test team CRUD operations, error paths, and date range search through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.1–28.3 — ~15 test cases covering team create, read, search, and error paths via Code Mode.

**Prerequisites:**

- Seed data S13–S14 are personal journal entries with `project_number: 5`, S15–S17 are team DB entries with `project_number: 5`.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 28: Team Tools via Code Mode

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured. If not configured, all team tools should return structured `{ success: false, error: "Team database not configured..." }`.
>
> **`team_delete_entry` is soft-delete only** — no `permanent` flag.

### 28.1 Team CRUD

```javascript
// Test code:
const created = await mj.team.teamCreateEntry({
  content: 'CM4 team entry test',
  tags: ['codemode4-team-test'],
  entry_type: 'standup',
  project_number: 5
})
const withAuthor = await mj.team.teamCreateEntry({
  content: 'CM4 team explicit author',
  author: 'CM4Bot',
  project_number: 5
})
const recent = await mj.team.teamGetRecent({ limit: 5, project_number: 5 })
const search = await mj.team.teamSearch({ query: 'CM4 team entry test', project_number: 5 })
const tagSearch = await mj.team.teamSearch({ tags: ['codemode4-team-test'], project_number: 5 })
const combined = await mj.team.teamSearch({
  query: 'team',
  tags: ['codemode4-team-test'],
  project_number: 5
})
const hybridAuto = await mj.team.teamSearch({ query: 'how did we fix performance', project_number: 5 })
const forcedFts = await mj.team.teamSearch({ query: 'CM4', mode: 'fts', project_number: 5 })
const noArgs = await mj.team.teamSearch({ project_number: 5 })

// New: get by ID, list tags
const detail = await mj.team.teamGetEntryById({ entry_id: created.entry.id, project_number: 5 })
const detailNoRels = await mj.team.teamGetEntryById({
  entry_id: created.entry.id,
  include_relationships: false,
  project_number: 5
})
const tags = await mj.team.teamListTags({ project_number: 5 })

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
  detailHasEntry: !!detail.entry,
  detailHasImportance: !!detail.importance,
  detailNoRelsEmpty: !detailNoRels.relationships?.length,
  tagCount: tags.tags?.length ?? 0,
}
```

| Check             | Expected                          |
| ----------------- | --------------------------------- |
| `createSuccess`   | `true`                            |
| `createAuthor`    | Non-empty string (auto-populated) |
| `explicitAuthor`  | `"CM4Bot"`                        |
| `recentHasAuthor` | `true`                            |
| `searchCount`     | ≥ 1                               |
| `tagSearchCount`  | ≥ 1                               |
| `hybridAutoCount` | ≥ 0                               |
| `forcedFtsCount`  | ≥ 1                               |
| `detailHasEntry`  | `true`                            |
| `tagCount`        | ≥ 1                               |

### 28.2 Team Error Paths

| Test               | Code                                                                                                                | Expected Result                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Invalid entry_type | `return await mj.team.teamCreateEntry({ content: "test", entry_type: "invalid", project_number: 5 });`                                 | `{ success: false, error: "..." }` |
| Nonexistent get    | `return await mj.team.teamGetEntryById({ entry_id: 999999, project_number: 5 });`                                                      | `{ success: false, error: "..." }` |
| Nonexistent update | `return await mj.team.teamUpdateEntry({ entry_id: 999999, content: "x", project_number: 5 });`                                         | `{ success: false, error: "..." }` |
| Nonexistent delete | `return await mj.team.teamDeleteEntry({ entry_id: 999999, project_number: 5 });`                                                       | `{ success: false, error: "..." }` |
| Invalid date range | `return await mj.team.teamSearchByDateRange({ start_date: "Jan 1", end_date: "Jan 31", project_number: 5 });`                          | `{ success: false, error: "..." }` |
| Merge same tag     | `return await mj.team.teamMergeTags({ source_tag: "x", target_tag: "x", project_number: 5 });`                                         | `{ success: false, error: "..." }` |
| Link nonexistent   | `return await mj.team.teamLinkEntries({ from_entry_id: 999999, to_entry_id: 1, relationship_type: "references", project_number: 5 });` | `{ success: false, error: "..." }` |

### 28.3 Team Date Range Search

```javascript
// Test code:
const results = await mj.team.teamSearchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  project_number: 5
})
const typed = await mj.team.teamSearchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  entry_type: 'standup',
  project_number: 5
})
const tagged = await mj.team.teamSearchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  tags: ['codemode4-team-test'],
  project_number: 5
})
return {
  hasEntries: Array.isArray(results.entries),
  count: results.count ?? 0,
  typedFiltered: typed.entries?.every((e) => e.entryType === 'standup') ?? true,
  taggedCount: tagged.entries?.length ?? 0,
}
```

| Check           | Expected |
| --------------- | -------- |
| `hasEntries`    | `true`   |
| `typedFiltered` | `true`   |

---

## Success Criteria

- [ ] `team_create_entry` with auto-detected and explicit `author` works
- [ ] `team_get_recent` returns entries with `author` field
- [ ] `team_search` filters by text, tags, and combined
- [ ] `team_get_entry_by_id` returns entry detail with `importance` and optional `relationships`
- [ ] `team_list_tags` returns tag list from team database
- [ ] `team_search_by_date_range` filters by date range, entry_type, and tags
- [ ] Invalid `entry_type` on team create returns structured error
- [ ] Nonexistent IDs return structured errors for get, update, delete, link
- [ ] Invalid date range returns structured error with format hint
- [ ] Merge same tag returns structured error
