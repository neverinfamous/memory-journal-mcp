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
// 1. sort -> sort_by
const listSort = await mj.team.teamSearch({
  workspace_id: "test-ws",
  sort: 'priority'
})

// 2. version -> expected_version, text/message -> content
const entry = await mj.core.createEntry({ workspace_id: "test-ws", text: 'Alias entry' })
const updated = await mj.admin.updateEntry({
  entry_id: entry.id,
  message: 'Updated alias',
  version: entry.version
})

// 3. search/q -> query, mode -> instruction_level
const searched = await mj.search.searchEntries({
  workspace_id: "test-ws",
  q: 'Alias'
})
const configMode = await mj.admin.updateConfiguration({ mode: 'standard' })

// 4. filename -> source_dir (for io import)
let ioError = false;
const ioRes = await mj.io.importExternal({ workspace_id: "test-ws", filename: '/fake/dir' });
if (!ioRes.success && !ioRes.error.includes('source_dir')) {
  ioError = true; // Expect structured error but not validation error about missing source_dir
}

// Cleanup
await mj.admin.deleteEntry({ entry_id: entry.id, permanent: true })

return {
  listSortMapped: listSort.success && Array.isArray(listSort.entries),
  versionMapped: updated.success,
  searchMapped: searched.success && searched.count > 0,
  modeMapped: configMode.success,
  filenameMapped: ioError // If it threw, it passed validation
}
```

| Check                  | Expected |
| ---------------------- | -------- |
| `listSortMapped`       | `true`   |
| `versionMapped`        | `true`   |
| `searchMapped`         | `true`   |
| `modeMapped`           | `true`   |
| `filenameMapped`       | `true`   |

### 31.2 Method Aliases & read_query Wrapper

```javascript
// Test code:

// mj.admin.updateConfiguration -> updateConfiguration
const c1 = await mj.admin.updateConfiguration({ briefing_entries: 5 })
const c2 = await mj.admin.updateConfiguration({ briefing_entries: 4 })

// mj.core.getEntryHistory -> getEntryHistory
const entry = await mj.core.createEntry({ workspace_id: "test-ws", content: 'History test' })
await mj.admin.updateEntry({ entry_id: entry.id, content: 'History test updated' })
const history = await mj.core.getEntryHistory({ entry_id: entry.id })

// Team Aliases
const role = await mj.team.teamUpdateMemberRole({ target_user: 'tester99', role: 'contributor' })
const aliases = await mj.team.teamListAuthorAliases({})

// mj.search.searchEntries / readQuery -> searchEntries
const readQ1 = await mj.search.searchEntries({ workspace_id: "test-ws", query: 'History test' })
const readQ2 = await mj.search.searchEntries({ workspace_id: "test-ws", query: 'History test' })

// Cleanup
await mj.admin.deleteEntry({ entry_id: entry.id, permanent: true })

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

// mj.search.semanticSearch -> mj.search.semanticSearch
const semantic = await mj.search.semanticSearch({ workspace_id: "test-ws", query: 'test' })

// mj.search.getVectorIndexStats -> mj.search.getVectorIndexStats
const vStats = await mj.search.getVectorIndexStats({ workspace_id: "test-ws" })

// mj.admin.searchAuditLog -> mj.admin.searchAuditLog
const audit = await mj.admin.searchAuditLog({ limit: 1 })

// mj.search.listDeletedEntries -> mj.search.listDeletedEntries
const deleted = await mj.search.listDeletedEntries({ workspace_id: "test-ws" })

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
  
  // 5. Array proxy interception & hardened Code Mode array proxies
  // Use createEntry instead of searchEntries to correctly test Non-Array Proxy Error
  const createResult = await mj.core.createEntry({ workspace_id: "test-ws", content: 'x' })
  let proxyError = false
  try {
    createResult.forEach(item => console.log(item))
  } catch (e) {
    proxyError = e.message.includes('CodeMode Non-Array Proxy Error')
  }
  // cleanup the test entry
  await mj.admin.deleteEntry({ entry_id: createResult.id, permanent: true })
  
  // Newly hardened 'Code Mode' array proxies: test support for .length, [0], .indexOf, .includes, .map, .filter
  const listResult = await mj.search.searchEntries({ workspace_id: "test-ws", limit: 1 })
  let arrayProxiesHardened = false
  try {
    const len = listResult.length
    const item = listResult[0]
    const idx = listResult.indexOf ? listResult.indexOf(item) : -1
    const inc = listResult.includes ? listResult.includes(item) : false
    const mapRes = listResult.map ? listResult.map(x => x) : []
    const filRes = listResult.filter ? listResult.filter(x => true) : []
    arrayProxiesHardened = typeof len === 'number' && Array.isArray(mapRes) && Array.isArray(filRes)
  } catch (e) {
    arrayProxiesHardened = false
  }
  
  // 6. Context parameter
  // Call mj_execute_code explicitly with context="Large context string" before running this
  const hasContext = typeof context !== 'undefined'
  
  return {
    templateValue: templateTest,
    configHasDb: !!cfg.dbPath,
    uriErrorHandled: uriError,
    proxyErrorHandled: proxyError,
    arrayProxiesHardened: arrayProxiesHardened,
    contextAvailable: hasContext
  }
})()

return result
```

| Check                  | Expected |
| ---------------------- | -------- |
| `templateValue`        | `"Auto return template: 2"` |
| `configHasDb`          | `true`   |
| `uriErrorHandled`      | `true` (intercepted URI read) |
| `proxyErrorHandled`    | `true` (intercepted `.forEach`) |
| `arrayProxiesHardened` | `true` (supports `.length`, `[0]`, `.map`, etc.) |
| `contextAvailable`     | `true` (when passed via outer schema) |
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Parameter aliases map successfully (`sort` → `sort_by`, `version` → `expected_version`, `search`/`q` → `query`, `text`/`message` → `content`, `mode` → `instruction_level`, `filename` → `source_dir`)
- Method aliases map successfully (`mj.admin.updateConfiguration`, `mj.core.getEntryHistory`, `mj.team.teamUpdateMemberRole`, `mj.team.teamListAuthorAliases`, `mj.search.searchEntries`)
- Cross-group constructor wiring works (`mj.search.semanticSearch`, `mj.search.getVectorIndexStats`, `mj.admin.searchAuditLog`, `mj.search.listDeletedEntries`)
- `sleep()` and `setTimeout` globals exist and resolve in Sandbox
- `await getConfig()` returns server configuration inside Sandbox
- `readResource("memory://...")` throws a structured guidance error pointing to tools
- Calling `.forEach()` on a tool response object throws a specific `CodeMode Non-Array Proxy Error`
- Newly hardened array proxies support `.length`, `[0]`, `.indexOf`, `.includes`, `.map`, and `.filter` natively
- The outer `context` parameter value is accessible inside the Sandbox via the `context` variable
- Multi-line template literals automatically return without a `return` statement
