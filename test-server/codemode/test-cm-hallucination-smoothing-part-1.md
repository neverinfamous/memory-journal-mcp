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

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.
- See part 2 for remaining success criteria.
