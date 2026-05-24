# Code Mode (Token-Efficient Multi-Step Operations)

For multi-step workflows (3+ operations), prefer `mj_execute_code` over individual tool calls.
This executes JavaScript in a sandboxed environment with all tools available as `mj.*` API:

| Group         | Namespace            | Example                                            |
| ------------- | -------------------- | -------------------------------------------------- |
| Core          | `mj.core.*`          | `mj.core.createEntry("Implemented feature X")`     |
| Search        | `mj.search.*`        | `mj.search.searchEntries("performance")`           |
| Analytics     | `mj.analytics.*`     | `mj.analytics.getStatistics()`                     |
| Relationships | `mj.relationships.*` | `mj.relationships.linkEntries(1, 2, "implements")` |
| IO            | `mj.io.*`            | `mj.io.importMarkdown("content")`                  |
| Admin         | `mj.admin.*`         | `mj.admin.rebuildVectorIndex()`                    |
| GitHub        | `mj.github.*`        | `mj.github.getGithubIssues({ state: "open" })`     |
| Backup        | `mj.backup.*`        | `mj.backup.backupJournal()`                        |
| Team          | `mj.team.*`          | `mj.team.teamCreateEntry("Team update")`           |

**Features**: Positional args (`createEntry("note")`), aliases (`mj.core.create`), `mj.help()` for discovery. `mj.export.*` is a backward-compat alias for `mj.io.*`.

**Parameter names are snake_case** (matching tool schemas), NOT camelCase:

```js
// ✅ Correct — snake_case params
await mj.core.createEntry({
  content: "Session summary",
  entry_type: "retrospective",
  tags: ["session-summary"],
  significance_type: "milestone",
  project_number: 5
})

// ❌ Wrong — camelCase params are silently ignored
await mj.core.createEntry({
  content: "Session summary",
  entryType: "retrospective",      // IGNORED
  significanceType: "milestone",    // IGNORED
  projectNumber: 5                  // IGNORED
})
```
**Readonly mode**: `readonly: true` restricts to read-only tools only. Read-only methods (e.g., `mj.search.searchEntries()`) work normally. Calling a mutation method (e.g., `mj.core.create(...)`) in readonly mode throws an error that halts execution — the sandbox returns `{ success: false, error: "Operation '...' is not found in group" }`. If a group has no methods at all (fully stripped), the error says `"no methods (read-only mode?)"`.
**Returns**: Last expression value. Errors return `{ success: false, error: "..." }`.

**GitHub Context Injection**: You can pass `repo: 'my-repo'` directly to `mj_execute_code` (e.g., `mj_execute_code({ code, repo: 'memory-journal-mcp' })`) to instantly bind that repository and its default Kanban board to all GitHub and Kanban tools running inside the sandbox, avoiding the need to pass `owner`/`repo` manually to individual methods inside.

**Important — all `mj.*` methods return Promises. Always `await` them:**

```js
// ✅ Correct
const result = await mj.core.recent({ limit: 5 })
return result.entries.map((e) => e.id)

// ❌ Wrong — returns a Promise object, not the entries
const result = mj.core.recent({ limit: 5 })

// ✅ Discovery
const help = await mj.help() // { groups, totalMethods, usage }
const groupHelp = await mj.core.help() // { group, methods }
const schema = await mj.core.createEntry.schema() // Returns a string of TypeScript types (e.g. "{ content?: string, entry_type?: string, ... }")
```

**`mj.core.recent()` return shape**: Returns `{ entries: JournalEntry[], count: number }` — not a plain array. Access `.entries` to iterate:

```js
const { entries, count } = await mj.core.recent({ limit: 10 })
return entries.map((e) => ({ id: e.id, content: e.content.slice(0, 50) }))
```
