# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps

Systematic verification of structured error handling across all `mj.*` API groups via the Code Mode sandbox. Validates that `{}` empty params, type mismatches, and domain errors all return structured `{success: false}` responses — never raw MCP exceptions.

**Scope:** 1 tool (`mj_execute_code`), Phase 29 — consolidated Zod sweep and type mismatch tests across all 10 API groups (including Hush Protocol flag tools).

**Prerequisites:**

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

## Phase 29: Error Matrix via Code Mode

> [!TIP]
> Each test block calls multiple tools with intentionally bad inputs in a single Code Mode execution — validating that every structured error returns `{success: false}` and never crashes the sandbox. Map results to compact summaries to keep token estimates low.

### 29.1 Core Group — Empty Params & Type Mismatches

```javascript
// Test code:
const createEmpty = await mj.core.createEntry({})
const createMinEmpty = await mj.core.createEntryMinimal({})
const getByIdEmpty = await mj.core.getEntryById({})
const recentEmpty = await mj.core.getRecentEntries({})
const statsEmpty = await mj.analytics.getStatistics({})
const tagsEmpty = await mj.core.listTags({})

// Type mismatches
const contentNum = await mj.core.createEntry({ content: 123 })
const limitStr = await mj.core.getRecentEntries({ limit: 'abc' })
const idStr = await mj.core.getEntryById({ entry_id: 'abc' })
const limitNeg = await mj.core.getRecentEntries({ limit: -1 })

return {
  createEmpty: createEmpty.success === false,
  createMinEmpty: createMinEmpty.success === false,
  getByIdEmpty: getByIdEmpty.success === false,
  recentDefaults: recentEmpty.entries?.length >= 0,
  statsDefaults: typeof statsEmpty.totalEntries === 'number',
  tagsDefaults: Array.isArray(tagsEmpty.tags),
  contentNumError: contentNum.success === false,
  limitStrHandled: limitStr.success === false || Array.isArray(limitStr.entries),
  idStrError: idStr.success === false,
  limitNegError: limitNeg.success === false,
}
```

| Check             | Expected                                   |
| ----------------- | ------------------------------------------ |
| `createEmpty`     | `true` (content required)                  |
| `createMinEmpty`  | `true` (content required)                  |
| `getByIdEmpty`    | `true` (entry_id required)                 |
| `recentDefaults`  | `true` (uses defaults)                     |
| `statsDefaults`   | `true` (uses defaults)                     |
| `tagsDefaults`    | `true` (no params needed)                  |
| `contentNumError` | `true` (content must be string)            |
| `limitStrHandled` | `true` (coerces or errors — never crashes) |
| `idStrError`      | `true` (entry_id must be number)           |
| `limitNegError`   | `true` (limit must be ≥ 1)                 |

### 29.2 Search Group — Empty Params & Boundaries

```javascript
// Test code:
const searchEmpty = await mj.search.searchEntries({})
const dateRangeEmpty = await mj.search.searchByDateRange({})
const semanticEmpty = await mj.search.semanticSearch({})
const vectorStatsEmpty = await mj.search.getVectorIndexStats({})

// Boundary tests
const limitOver = await mj.search.searchEntries({ query: 'test', limit: 501 })
const thresholdStr = await mj.search.semanticSearch({ query: 'test', similarity_threshold: 'abc' })
const dateInvalid = await mj.search.searchByDateRange({ start_date: 'Jan 1', end_date: 'Jan 31' })
const dateInverted = await mj.search.searchByDateRange({
  start_date: '2026-12-31',
  end_date: '2026-01-01',
})

return {
  searchEmptyHandled: searchEmpty.success === false || Array.isArray(searchEmpty.entries),
  dateRangeEmptyError: dateRangeEmpty.success === false,
  semanticEmptyError: semanticEmpty.success === false,
  vectorStatsOk: typeof vectorStatsEmpty.available === 'boolean',
  limitOverError: limitOver.success === false,
  thresholdStrError: thresholdStr.success === false,
  dateInvalidError: dateInvalid.success === false,
  dateInvertedError: dateInverted.success === false,
}
```

| Check                 | Expected                            |
| --------------------- | ----------------------------------- |
| `dateRangeEmptyError` | `true` (start/end date required)    |
| `semanticEmptyError`  | `true` (query or entry_id required) |
| `vectorStatsOk`       | `true` (no params needed)           |
| `limitOverError`      | `true` (limit max 500)              |
| `dateInvalidError`    | `true` (YYYY-MM-DD required)        |
| `dateInvertedError`   | `true` (start must be before end)   |

### 29.3 Admin Group — Empty Params & Domain Errors

```javascript
// Test code:
const updateEmpty = await mj.admin.updateEntry({})
const deleteEmpty = await mj.admin.deleteEntry({})
const mergeEmpty = await mj.admin.mergeTags({})
const addVecEmpty = await mj.admin.addToVectorIndex({})
const rebuildEmpty = await mj.admin.rebuildVectorIndex({})

// Domain errors
const updateBadId = await mj.admin.updateEntry({ entry_id: 999999, content: 'fail' })
const deleteBadId = await mj.admin.deleteEntry({ entry_id: 999999 })
const mergeSame = await mj.admin.mergeTags({ source_tag: 'same', target_tag: 'same' })
const addVecBadId = await mj.admin.addToVectorIndex({ entry_id: 999999 })

// Type mismatches
const updateStrId = await mj.admin.updateEntry({ entry_id: 'abc', content: 'fail' })
const deleteStrId = await mj.admin.deleteEntry({ entry_id: 'abc' })

return {
  updateEmptyError: updateEmpty.success === false,
  deleteEmptyError: deleteEmpty.success === false,
  mergeEmptyError: mergeEmpty.success === false,
  addVecEmptyError: addVecEmpty.success === false,
  rebuildOk: rebuildEmpty.success === true,
  updateBadIdError: updateBadId.success === false,
  deleteBadIdError: deleteBadId.success === false,
  mergeSameError: mergeSame.success === false,
  addVecBadIdError: addVecBadId.success === false,
  updateStrIdError: updateStrId.success === false,
  deleteStrIdError: deleteStrId.success === false,
}
```

| Check              | Expected                                |
| ------------------ | --------------------------------------- |
| `updateEmptyError` | `true` (entry_id required)              |
| `deleteEmptyError` | `true` (entry_id required)              |
| `mergeEmptyError`  | `true` (source_tag/target_tag required) |
| `addVecEmptyError` | `true` (entry_id required)              |
| `rebuildOk`        | `true` (no required params)             |
| `mergeSameError`   | `true` (same tag blocked)               |
| `updateStrIdError` | `true` (entry_id must be number)        |

### 29.4 Relationships Group — Empty Params & Errors

```javascript
// Test code:
const linkEmpty = await mj.relationships.linkEntries({})
const vizEmpty = await mj.relationships.visualizeRelationships({})

const linkBadSource = await mj.relationships.linkEntries({
  from_entry_id: 999999,
  to_entry_id: 1,
  relationship_type: 'references',
})
const linkBadTarget = await mj.relationships.linkEntries({
  from_entry_id: 1,
  to_entry_id: 999999,
  relationship_type: 'references',
})
const linkBadType = await mj.relationships.linkEntries({
  from_entry_id: 1,
  to_entry_id: 2,
  relationship_type: 'invalid_type',
})

return {
  linkEmptyError: linkEmpty.success === false,
  vizEmptyHandled: typeof vizEmpty.mermaid === 'string' || vizEmpty.success === false,
  linkBadSourceError: linkBadSource.success === false,
  linkBadTargetError: linkBadTarget.success === false,
  linkBadTypeError: linkBadType.success === false,
}
```

| Check                | Expected                           |
| -------------------- | ---------------------------------- |
| `linkEmptyError`     | `true` (from/to entry_id required) |
| `linkBadSourceError` | `true` (source entry not found)    |
| `linkBadTargetError` | `true` (target entry not found)    |
| `linkBadTypeError`   | `true` (invalid relationship type) |

### 29.5 Backup Group — Empty Params & Security

```javascript
// Test code:
const backupEmpty = await mj.backup.backupJournal({})
const listEmpty = await mj.backup.listBackups({})
const restoreEmpty = await mj.backup.restoreBackup({})
const cleanupEmpty = await mj.backup.cleanupBackups({})

// Security
const backupTraversal = await mj.backup.backupJournal({ name: '../../etc/passwd' })
const restoreBadFile = await mj.backup.restoreBackup({ filename: 'nonexistent.db', confirm: true })
const cleanupZero = await mj.backup.cleanupBackups({ keep_count: 0 })

return {
  backupEmptyOk: backupEmpty.success === true,
  listEmptyOk: listEmpty.backups !== undefined || listEmpty.total !== undefined,
  restoreEmptyError: restoreEmpty.success === false,
  cleanupEmptyOk: cleanupEmpty.success === true || cleanupEmpty.success === false,
  traversalBlocked: backupTraversal.success === false,
  restoreBadFileError: restoreBadFile.success === false,
  cleanupZeroError: cleanupZero.success === false,
}
```

| Check                 | Expected                         |
| --------------------- | -------------------------------- |
| `backupEmptyOk`       | `true` (auto-names backup)       |
| `restoreEmptyError`   | `true` (filename required)       |
| `traversalBlocked`    | `true` (path traversal rejected) |
| `restoreBadFileError` | `true` (file not found)          |
| `cleanupZeroError`    | `true` (keep_count min 1)        |

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
const createEmpty = await mj.team.teamCreateEntry({})
const getByIdEmpty = await mj.team.teamGetEntryById({})
const recentEmpty = await mj.team.teamGetRecent({})
const searchEmpty = await mj.team.teamSearch({})
const tagsEmpty = await mj.team.teamListTags({})
const dateRangeEmpty = await mj.team.teamSearchByDateRange({})
const updateEmpty = await mj.team.teamUpdateEntry({})
const deleteEmpty = await mj.team.teamDeleteEntry({})
const mergeEmpty = await mj.team.teamMergeTags({})
const linkEmpty = await mj.team.teamLinkEntries({})
const vizEmpty = await mj.team.teamVisualizeRelationships({})
const exportEmpty = await mj.team.teamExportEntries({})
const backupEmpty = await mj.team.teamBackup({})
const listBackupsEmpty = await mj.team.teamListBackups({})
const semanticEmpty = await mj.team.teamSemanticSearch({})
const vecStatsEmpty = await mj.team.teamGetVectorIndexStats({})
const statsEmpty = await mj.team.teamGetStatistics({})
const insightsEmpty = await mj.team.teamGetCrossProjectInsights({})
const passFlagEmpty = await mj.team.passTeamFlag({})
const resolveFlagEmpty = await mj.team.resolveTeamFlag({})

// Type mismatches
const createNumContent = await mj.team.teamCreateEntry({ content: 123 })
const updateStrId = await mj.team.teamUpdateEntry({ entry_id: 'abc', content: 'test' })
const resolveFlagStrId = await mj.team.resolveTeamFlag({ flag_id: 'abc' })

return {
  createEmptyError: createEmpty.success === false,
  getByIdEmptyError: getByIdEmpty.success === false,
  recentEmptyError: recentEmpty.success === false,
  searchHandled: Array.isArray(searchEmpty.entries) || searchEmpty.success === false,
  tagsOk: Array.isArray(tagsEmpty.tags),
  dateRangeEmptyError: dateRangeEmpty.success === false,
  updateEmptyError: updateEmpty.success === false,
  deleteEmptyError: deleteEmpty.success === false,
  mergeEmptyError: mergeEmpty.success === false,
  linkEmptyError: linkEmpty.success === false,
  backupOk: backupEmpty.success === true,
  semanticEmptyError: semanticEmpty.success === false,
  statsOk: typeof statsEmpty.totalEntries === 'number',
  insightsOk: typeof insightsEmpty.project_count === 'number',
  passFlagEmptyError: passFlagEmpty.success === false,
  resolveFlagEmptyError: resolveFlagEmpty.success === false,
  createNumContentError: createNumContent.success === false,
  updateStrIdError: updateStrId.success === false,
  resolveFlagStrIdError: resolveFlagStrId.success === false,
}
```

| Check                   | Expected                              |
| ----------------------- | ------------------------------------- |
| `createEmptyError`      | `true` (content required)             |
| `getByIdEmptyError`     | `true` (entry_id required)            |
| `recentEmptyError`      | `true` (project_number required)      |
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

- [ ] All 10 `mj.*` API groups tested with `{}` empty params
- [ ] Type mismatches (string where number, number where string) return structured errors
- [ ] Domain errors (nonexistent IDs, same-tag merge, 404s) return `{success: false}`
- [ ] Security boundaries (path traversal, limit overflow) enforced
- [ ] No sandbox crashes, no raw MCP exceptions leaked through Code Mode
- [ ] All results map to compact summaries (no large payload inflation)
