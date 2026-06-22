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

### 29.6 GitHub Group — Empty Params & Not-Found

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const issuesEmpty = await mj.github.getGithubIssues({})
const prsEmpty = await mj.github.getGithubPrs({})
const contextEmpty = await mj.github.getGithubContext({})
const milestonesEmpty = await mj.github.getGithubMilestones({})
const insightsEmpty = await mj.github.getRepoInsights({})

const issueBadNum = await mj.github.getGithubIssue({ issue_number: 999999 })
const prBadNum = await mj.github.getGithubPr({ pr_number: 999999 })
const msBadNum = await mj.github.getGithubMilestone({ milestone_number: 999999 })
const kanbanBadNum = await mj.github.getKanbanBoard({ project_number: 99999 })

const issueEmpty = await mj.github.getGithubIssue({})
const prEmpty = await mj.github.getGithubPr({})

return {
  issuesOk: Array.isArray(issuesEmpty.issues),
  prsOk: Array.isArray(prsEmpty.pullRequests),
  contextOk: !!contextEmpty.repoName,
  milestonesOk: Array.isArray(milestonesEmpty.milestones),
  insightsOk: typeof insightsEmpty.stars === 'number',
  issueBadNumError: !!issueBadNum.error,
  prBadNumError: !!prBadNum.error,
  msBadNumError: !!msBadNum.error,
  kanbanBadNumError: !!kanbanBadNum.error,
  issueEmptyError: !!issueEmpty.error || issueEmpty.success === false,
  prEmptyError: !!prEmpty.error || prEmpty.success === false,
}
```

| Check              | Expected                         |
| ------------------ | -------------------------------- |
| `issuesOk`         | `true` (defaults to open issues) |
| `contextOk`        | `true` (auto-detects repo)       |
| `issueBadNumError` | `true` (404 structured error)    |
| `prBadNumError`    | `true` (404 structured error)    |
| `issueEmptyError`  | `true` (issue_number required)   |

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
const passFlagEmpty = await mj.team.passTeamFlag({ project_number: 5 })
const resolveFlagEmpty = await mj.team.resolveTeamFlag({})
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
const resolveFlagStrId = await mj.team.resolveTeamFlag({ flag_id: 'abc' })
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
  passFlagEmptyError: passFlagEmpty.success === false,
  resolveFlagEmptyError: resolveFlagEmpty.success === false,
  createNumContentError: createNumContent.success === false,
  updateStrIdError: updateStrId.success === false,
  resolveFlagStrIdError: resolveFlagStrId.success === false,
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
| `passFlagEmptyError`    | `true` (flag_type + message required) |
| `resolveFlagEmptyError` | `true` (flag_id required)             |
| `createNumContentError` | `true` (content must be string)       |
| `resolveFlagStrIdError` | `true` (flag_id must be number)       |
| `teamSearchTypeMismatchError` | `true` (type mismatches caught) |
| `crossTeamSearchTypeMismatchError` | `true` (type mismatches caught) |

### 29.8 IO Group — Empty Params & Security

```javascript
// Test code:
const exportEmpty = await mj.io.exportEntries({})
const exportMdEmpty = await mj.io.exportMarkdown({})
const importMdEmpty = await mj.io.importMarkdown({})

// Type mismatches
const exportBadFormat = await mj.io.exportEntries({ format: 'xml' })
const exportLimitStr = await mj.io.exportEntries({ format: 'json', limit: 'abc' })

return {
  exportEmptyOk:
    exportEmpty.success !== undefined ||
    exportEmpty.entries !== undefined ||
    exportEmpty.content !== undefined,
  exportMdEmptyError: exportMdEmpty.success === false,
  importMdEmptyError: importMdEmpty.success === false,
  exportBadFormatHandled:
    exportBadFormat.success === false || typeof exportBadFormat.content === 'string',
  exportLimitStrHandled: exportLimitStr.success === false || exportLimitStr.entries !== undefined,
}
```

| Check                | Expected                     |
| -------------------- | ---------------------------- |
| `exportMdEmptyError` | `true` (output_dir required) |
| `importMdEmptyError` | `true` (source_dir required) |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- All 10 `mj.*` API groups tested with `{}` empty params
- Type mismatches (string where number, number where string) return structured errors
- Domain errors (nonexistent IDs, same-tag merge, 404s) return `{success: false}`
- Security boundaries (path traversal, limit overflow) enforced
- No sandbox crashes, no raw MCP exceptions leaked through Code Mode
- All results map to compact summaries (no large payload inflation)
