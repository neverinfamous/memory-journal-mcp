# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps (Part 2)

Systematic verification of structured error handling across remaining API groups.

**Scope:** 1 tool (mj_execute_code), Phase 29B.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found.
2. Use code-map.md as a source of truth.
3. If you made code changes/fixes, update UNRELEASED.md and commit.
4. Re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

---

## Phase 29B: Error Matrix via Code Mode (Continued)



### 29.7 Team Group — Empty Params & DB Not Configured

```javascript
// Test code:
const createEmpty = await mj.team.teamCreateEntry({ project_number: 5 })
const getByIdEmpty = await mj.team.teamGetEntryById({ project_number: 5 })
const recentEmpty = await mj.team.teamGetRecent({ project_number: 5 })
const searchEmpty = await mj.team.teamSearch({ project_number: 5 })
const tagsEmpty = await mj.team.teamListTags({})
const dateRangeEmpty = await mj.team.teamSearchByDateRange({ project_number: 5 })
const updateEmpty = await mj.team.teamUpdateEntry({ project_number: 5 })
const deleteEmpty = await mj.team.teamDeleteEntry({ project_number: 5 })
const mergeEmpty = await mj.team.teamMergeTags({ project_number: 5 })
const linkEmpty = await mj.team.teamLinkEntries({ project_number: 5 })
const vizEmpty = await mj.team.teamVisualizeRelationships({ project_number: 5 })
const exportEmpty = await mj.team.teamExportEntries({ project_number: 5 })
const backupEmpty = await mj.team.teamBackup({})
const listBackupsEmpty = await mj.team.teamListBackups({})
const semanticEmpty = await mj.team.teamSemanticSearch({ project_number: 5 })
const vecStatsEmpty = await mj.team.teamGetVectorIndexStats({})
const statsEmpty = await mj.team.teamGetStatistics({})
const insightsEmpty = await mj.team.teamGetCrossProjectInsights({})
const crossTeamSearchTypeMismatch = await mj.search.crossTeamSearch({ team_dbs: "invalid_type" })

// Type mismatches
const createNumContent = await mj.team.teamCreateEntry({
  project_number: 5,
  content: 123,
})
const updateStrId = await mj.team.teamUpdateEntry({
  project_number: 5,
  entry_id: 'abc',
  content: 'test',
})
const teamSearchTypeMismatch = await mj.team.teamSearch({ project_number: 5, query: 123 })

return {
  createEmptyError: createEmpty.success === false,
  getByIdEmptyError: getByIdEmpty.success === false,
  recentOk: recentEmpty.success === false || Array.isArray(recentEmpty.entries),
  searchHandled: searchEmpty.success === false || Array.isArray(searchEmpty.entries),
  tagsOk: tagsEmpty.success === false || Array.isArray(tagsEmpty.tags),
  dateRangeEmptyError: dateRangeEmpty.success === false,
  updateEmptyError: updateEmpty.success === false,
  deleteEmptyError: deleteEmpty.success === false,
  mergeEmptyError: mergeEmpty.success === false,
  linkEmptyError: linkEmpty.success === false,
  backupOk: backupEmpty.success === false || backupEmpty.success === true,
  semanticEmptyError: semanticEmpty.success === false,
  statsOk: statsEmpty.success === false || typeof statsEmpty.totalEntries === 'number',
  insightsOk: insightsEmpty.success === false || typeof insightsEmpty.project_count === 'number',
  createNumContentError: createNumContent.success === false,
  updateStrIdError: updateStrId.success === false,
  teamSearchTypeMismatchError: teamSearchTypeMismatch.success === false,
  crossTeamSearchTypeMismatchError: crossTeamSearchTypeMismatch.success === false,
}
```

| Check                   | Expected                              |
| ----------------------- | ------------------------------------- |
| `createEmptyError`      | `true` (content required)             |
| `getByIdEmptyError`     | `true` (entry_id required)            |
| `recentOk`              | `true` (uses defaults)                |
| `tagsOk`                | `true` (no params needed)             |
| `dateRangeEmptyError`   | `true` (start/end date required)      |
| `updateEmptyError`      | `true` (entry_id required)            |
| `deleteEmptyError`      | `true` (entry_id required)            |
| `mergeEmptyError`       | `true` (source/target required)       |
| `linkEmptyError`        | `true` (from/to entry_id required)    |
| `createNumContentError` | `true` (content must be string)       |
| `teamSearchTypeMismatchError` | `true` (type mismatches caught) |
| `crossTeamSearchTypeMismatchError` | `true` (type mismatches caught) |


