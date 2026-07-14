# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps (Part 2)

Systematic verification of structured error handling across remaining API groups.

**Scope:** 1 tool (mj_execute_code), Phase 29B.

**Prerequisites:**

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
const linkEmpty = await mj.team.teamLinkEntries({ workspace_id: "test-ws" })
const vizEmpty = await mj.team.teamVisualizeRelationships({ workspace_id: "test-ws" })
const exportEmpty = await mj.team.teamExportEntries({ workspace_id: "test-ws" })
const backupEmpty = await mj.team.teamBackup({})
const listBackupsEmpty = await mj.team.teamListBackups({})
const semanticEmpty = await mj.team.teamSemanticSearch({ workspace_id: "test-ws" })
const vecStatsEmpty = await mj.team.teamGetVectorIndexStats({})
const statsEmpty = await mj.team.teamGetStatistics({})
const insightsEmpty = await mj.team.teamGetCrossProjectInsights({})
const crossTeamSearchTypeMismatch = await mj.search.crossTeamSearch({ team_dbs: "invalid_type" })

// Type mismatches
const createNumContent = await mj.team.teamCreateEntry({
  workspace_id: "test-ws",
  content: 123,
})
const updateStrId = await mj.team.teamUpdateEntry({
  workspace_id: "test-ws",
  entry_id: 'abc',
  content: 'test',
})
const teamSearchTypeMismatch = await mj.team.teamSearch({ workspace_id: "test-ws", query: 123 })

return {
  
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
| `linkEmptyError`        | `true` (from/to entry_id required)    |
| `createNumContentError` | `true` (content must be string)       |
| `teamSearchTypeMismatchError` | `true` (type mismatches caught) |
| `crossTeamSearchTypeMismatchError` | `true` (type mismatches caught) |


