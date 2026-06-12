# Re-Test memory-journal-mcp — Code Mode: Hallucination Smoothing

Test the Code Mode Sandbox resilience, hallucination-smoothing parameter/method aliases, cross-group constructor wiring, and API discovery features.

**Scope:** 1 tool (`mj_execute_code`), Phase 31 — ~15 test cases covering `PARAM_ALIASES`, `METHOD_ALIASES`, Sandbox built-ins, and `context` handling.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify.
3. Clean up any test artifacts generated.
4. Provide a very brief final summary including the **Total Token Estimate**.

---

## Phase 31: Hallucination Smoothing & Sandbox Resilience

### 31.1 Parameter Aliases (PARAM_ALIASES)

Test that common agent hallucinations (`user`, `msg`, `severity`, `version`, `search`, etc.) map correctly to the true parameter names.

```javascript
// Test code:
// 1. user -> target_user, severity -> flag_type, msg -> message, sort -> sort_by
const aliasFlag = await mj.team.passTeamFlag({
  project_number: 5,
  severity: 'fyi',
  msg: 'CM param alias test',
  user: '@sarah'
})

const listFlags = await mj.team.teamListFlags({
  project_number: 5,
  status: 'all',
  sort: 'priority'
})

// 2. comment -> resolution
const resolved = await mj.team.resolveTeamFlag({
  flag_id: aliasFlag.entry?.id,
  comment: 'Resolved via alias'
})

// 3. version -> expected_version
const entry = await mj.core.createEntry({ project_number: 5, content: 'Alias entry' })
const updated = await mj.core.updateEntry({
  entry_id: entry.id,
  content: 'Updated alias',
  version: entry.version
})

// 4. search -> query
const searched = await mj.core.searchEntries({
  project_number: 5,
  search: 'Alias'
})

// 5. filename -> source_dir (for io import)
let ioError = false;
const ioRes = await mj.io.importExternal({ project_number: 5, filename: '/fake/dir' });
if (!ioRes.success && !ioRes.error.includes('source_dir')) {
  ioError = true; // Expect structured error but not validation error about missing source_dir
}

// Cleanup
await mj.team.teamDeleteEntry({ project_number: 5, entry_id: aliasFlag.entry?.id, permanent: true })
await mj.core.deleteEntry({ entry_id: entry.id, permanent: true })

return {
  flagAliasSuccess: aliasFlag.success,
  flagAliasUserMapped: aliasFlag.target_user === 'sarah',
  listSortMapped: listFlags.success && typeof listFlags.count === 'number',
  resolveCommentMapped: resolved.resolution === 'Resolved via alias',
  versionMapped: updated.success,
  searchMapped: searched.success && searched.count > 0,
  filenameMapped: ioError // If it threw, it passed validation
}
```

| Check                  | Expected |
| ---------------------- | -------- |
| `flagAliasSuccess`     | `true`   |
| `flagAliasUserMapped`  | `true`   |
| `listSortMapped`       | `true`   |
| `resolveCommentMapped` | `true`   |
| `versionMapped`        | `true`   |
| `searchMapped`         | `true`   |
| `filenameMapped`       | `true`   |

### 31.2 Method Aliases & read_query Wrapper

```javascript
// Test code:

// mj.admin.config -> updateConfiguration
const c1 = await mj.admin.config({ briefing_entries: 5 })
const c2 = await mj.admin.config({ briefing_entries: 4 })

// mj.core.history -> getEntryHistory
const entry = await mj.core.createEntry({ project_number: 5, content: 'History test' })
await mj.core.updateEntry({ entry_id: entry.id, content: 'History test updated' })
const history = await mj.core.history({ entry_id: entry.id })

// Team Aliases
const role = await mj.team.setRole({ target_user: 'tester99', role: 'contributor' })
const aliases = await mj.team.aliases({})

// mj.search.read_query / readQuery -> searchEntries
const readQ1 = await mj.search.readQuery({ project_number: 5, query: 'History test' })
const readQ2 = await mj.search.read_query({ project_number: 5, query: 'History test' })

// Cleanup
await mj.core.deleteEntry({ entry_id: entry.id, permanent: true })

return {
  configAlias: c1.success && c2.success,
  historyAlias: history.revisions?.length > 0,
  teamRoleAlias: role.success,
  teamAliasesAlias: aliases.success,
  readQueryAlias: readQ1.success,
  readQuerySnake: readQ2.success
}
```

| Check              | Expected |
| ------------------ | -------- |
| `configAlias`      | `true`   |
| `historyAlias`     | `true`   |
| `teamRoleAlias`    | `true`   |
| `teamAliasesAlias` | `true`   |
| `readQueryAlias`   | `true`   |
| `readQuerySnake`   | `true`   |

### 31.3 Cross-Group Constructor Wiring

Test that tools technically defined in one group (e.g. `semantic` or `admin`) but logically related to `core` can be called from `mj.core`.

```javascript
// Test code:

// mj.core.semanticSearch -> mj.semantic.semanticSearch
const semantic = await mj.core.semanticSearch({ project_number: 5, query: 'test' })

// mj.core.vectorStats -> mj.semantic.vectorStats
const vStats = await mj.core.vectorStats({ project_number: 5 })

// mj.core.searchAuditLog -> mj.admin.searchAuditLog
const audit = await mj.core.searchAuditLog({ limit: 1 })

// mj.core.listDeletedEntries -> mj.admin.listDeletedEntries
const deleted = await mj.core.listDeletedEntries({ project_number: 5 })

return {
  semanticSuccess: semantic.success,
  vStatsSuccess: vStats.success,
  auditSuccess: audit.success,
  deletedSuccess: deleted.success
}
```

| Check             | Expected |
| ----------------- | -------- |
| `semanticSuccess` | `true`   |
| `vStatsSuccess`   | `true`   |
| `auditSuccess`    | `true`   |
| `deletedSuccess`  | `true`   |

### 31.4 Sandbox Built-ins & Resilience

Test `context`, globals (`sleep`, `getConfig`), error mapping, and proxy behavior.

```javascript
// Test code:

// 1. Template literal auto-return (no 'return' keyword)
const templateTest = `Auto return template: ${1 + 1}`

// Execute a nested block to test
const result = await (async () => {
  // 2. sleep() / setTimeout globals
  await sleep(10)
  await new Promise(r => setTimeout(r, 10))
  
  // 3. getConfig()
  const cfg = await getConfig()
  
  // 4. readResource URI handler
  let uriError = false
  try {
    await readResource('memory://recent')
  } catch (e) {
    uriError = e.message.includes('mj.core.getRecentEntries')
  }
  
  // 5. Array proxy interception
  // Use createEntry instead of searchEntries to correctly test Non-Array Proxy Error
  const createResult = await mj.core.createEntry({ project_number: 5, content: 'x' })
  let proxyError = false
  try {
    createResult.forEach(item => console.log(item))
  } catch (e) {
    proxyError = e.message.includes('CodeMode Non-Array Proxy Error')
  }
  // cleanup the test entry
  await mj.core.deleteEntry({ entry_id: createResult.id, permanent: true })
  
  // 6. Context parameter
  // Call mj_execute_code explicitly with context="Large context string" before running this
  const hasContext = typeof context !== 'undefined'
  
  return {
    templateValue: templateTest,
    configHasDb: !!cfg.dbPath,
    uriErrorHandled: uriError,
    proxyErrorHandled: proxyError,
    contextAvailable: hasContext
  }
})()

return result
```

| Check               | Expected |
| ------------------- | -------- |
| `templateValue`     | `"Auto return template: 2"` |
| `configHasDb`       | `true`   |
| `uriErrorHandled`   | `true` (intercepted URI read) |
| `proxyErrorHandled` | `true` (intercepted `.forEach`) |
| `contextAvailable`  | `true` (when passed via outer schema) |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Parameter aliases map successfully (`user` → `target_user`, `msg` → `message`, `severity` → `flag_type`, `comment` → `resolution`, `sort` → `sort_by`, `version` → `expected_version`, `search` → `query`, `filename` → `source_dir`)
- Method aliases map successfully (`mj.admin.config`, `mj.core.history`, `mj.team.setRole`, `mj.team.aliases`, `mj.search.read_query`)
- Cross-group constructor wiring works (`mj.core.semanticSearch`, `mj.core.vectorStats`, `mj.core.searchAuditLog`, `mj.core.listDeletedEntries`)
- `sleep()` and `setTimeout` globals exist and resolve in Sandbox
- `await getConfig()` returns server configuration inside Sandbox
- `readResource("memory://...")` throws a structured guidance error pointing to tools
- Calling `.forEach()` on a tool response object throws a specific `CodeMode Non-Array Proxy Error`
- The outer `context` parameter value is accessible inside the Sandbox via the `context` variable
- Multi-line template literals automatically return without a `return` statement
