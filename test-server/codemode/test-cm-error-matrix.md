# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps

Systematic verification of structured error handling across all `mj.*` API groups via the Code Mode sandbox. Validates that `{}` empty params, type mismatches, and domain errors all return structured `{success: false}` responses — never raw MCP exceptions.

**Scope:** 1 tool (`mj_execute_code`), Phase 29 — consolidated Zod sweep and type mismatch tests across all 10 API groups.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
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
const createEmpty = await mj.core.createEntry({ project_number: 5 })
const createMinEmpty = await mj.core.createEntry({ project_number: 5, })
const getByIdEmpty = await mj.core.getEntryById({})
const recentEmpty = await mj.core.getRecentEntries({ project_number: 5 })
const statsEmpty = await mj.analytics.getStatistics({})
const tagsEmpty = await mj.core.listTags({})
const getHistoryEmpty = await mj.core.getEntryHistory({})

// Type mismatches
const contentNum = await mj.core.createEntry({ project_number: 5, content: 123 })
const limitStr = await mj.core.getRecentEntries({ project_number: 5, limit: 'abc' })
const idStr = await mj.core.getEntryById({ entry_id: 'abc' })
const limitNeg = await mj.core.getRecentEntries({ project_number: 5, limit: -1 })
const historyIdStr = await mj.core.getEntryHistory({ entry_id: 'abc' })

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
  getHistoryEmptyError: getHistoryEmpty.success === false,
  historyIdStrError: historyIdStr.success === false,
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
| `getHistoryEmptyError` | `true` (entry_id required)            |
| `historyIdStrError` | `true` (entry_id must be number)         |

### 29.2 Search Group — Empty Params & Boundaries

```javascript
// Test code:
const searchEmpty = await mj.search.searchEntries({ project_number: 5 })
const dateRangeEmpty = await mj.search.searchByDateRange({ project_number: 5 })
const semanticEmpty = await mj.search.semanticSearch({})
const vectorStatsEmpty = await mj.search.getVectorIndexStats({})

// Boundary tests
const limitOver = await mj.search.searchEntries({ project_number: 5, query: 'test', limit: 501 })
const thresholdStr = await mj.search.semanticSearch({ query: 'test', similarity_threshold: 'abc' })
const dateInvalid = await mj.search.searchByDateRange({
  project_number: 5,
  start_date: 'Jan 1',
  end_date: 'Jan 31',
})
const dateInverted = await mj.search.searchByDateRange({
  project_number: 5,
  start_date: '2026-12-31',
  end_date: '2026-01-01',
})
const searchTypeMismatch = await mj.search.searchEntries({ project_number: 5, query: 'test', fts_weight: 'abc', include_highlights: 'abc' })

return {
  searchEmptyHandled: searchEmpty.success === false || Array.isArray(searchEmpty.entries),
  dateRangeEmptyError: dateRangeEmpty.success === false,
  semanticEmptyError: semanticEmpty.success === false,
  vectorStatsOk: typeof vectorStatsEmpty.available === 'boolean',
  limitOverError: limitOver.success === false,
  thresholdStrError: thresholdStr.success === false,
  dateInvalidError: dateInvalid.success === false,
  dateInvertedError: dateInverted.success === false,
  searchTypeMismatchError: searchTypeMismatch.success === false,
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
| `searchTypeMismatchError` | `true` (type mismatches caught) |

### 29.3 Admin Group — Empty Params & Domain Errors

```javascript
// Test code:
const updateEmpty = await mj.admin.updateEntry({})
const deleteEmpty = await mj.admin.deleteEntry({})
const mergeEmpty = await mj.admin.mergeTags({})
const addVecEmpty = await mj.admin.addToVectorIndex({})
const rebuildEmpty = await mj.admin.rebuildVectorIndex({})
const auditEmpty = await mj.admin.searchAuditLog({})

// Domain errors
const updateBadId = await mj.admin.updateEntry({ entry_id: 999999, content: 'fail' })
const deleteBadId = await mj.admin.deleteEntry({ entry_id: 999999 })
const mergeSame = await mj.admin.mergeTags({ source_tag: 'same', target_tag: 'same' })
const addVecBadId = await mj.admin.addToVectorIndex({ entry_id: 999999 })

// Type mismatches
const updateStrId = await mj.admin.updateEntry({ entry_id: 'abc', content: 'fail' })
const deleteStrId = await mj.admin.deleteEntry({ entry_id: 'abc' })
const auditLimitStr = await mj.admin.searchAuditLog({ limit: 'abc' })
const auditLimitNeg = await mj.admin.searchAuditLog({ limit: -1 })

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
  auditEmptyOk: Array.isArray(auditEmpty.results) || auditEmpty.success === false,
  auditLimitStrError: auditLimitStr.success === false,
  auditLimitNegError: auditLimitNeg.success === false,
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
| `auditEmptyOk`     | `true` (no required params)             |
| `auditLimitStrError`| `true` (limit must be number)          |
| `auditLimitNegError`| `true` (limit min 1)                   |

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

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- All 10 `mj.*` API groups tested with `{}` empty params
- Type mismatches (string where number, number where string) return structured errors
- Domain errors (nonexistent IDs, same-tag merge, 404s) return `{success: false}`
- Security boundaries (path traversal, limit overflow) enforced
- No sandbox crashes, no raw MCP exceptions leaked through Code Mode
- All results map to compact summaries (no large payload inflation)
