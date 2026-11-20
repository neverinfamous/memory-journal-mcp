# Code Mode API Reference

In Code Mode (`mj_execute_code`), you do NOT have native MCP tool schemas. You must orchestrate the server using the `mj.*` API inside the sandbox.

## Sandbox Environment
- **Top-Level `mj_execute_code` Parameters:** Pass `workspace_id` (or `repository`), `project_number`, `repo` (for `git`/`github`), `session_id` (active conversation UUID), `context` (`{ content }` or `{ entry }`), `readonly`, `dry_run`, `auto_version` (default `true`), `max_result_size`, and `timeout` alongside `code`.
- **Schema Introspection:** Call `await mj.<group>.<method>.schema()` (e.g. `await mj.core.createEntry.schema()`) at any time — including when `readonly: true` — to inspect parameter definitions before calling unfamiliar methods. Call `mj.help()` (`{ groups, totalMethods, usage }`) or `mj.<group>.help()` for namespace discovery.
- **Network:** Disabled. `fetch()` is blocked and returns a 403 `VALIDATION_ERROR` response object. Node network modules are stripped.
- **Native Modules & Shims:** `child_process`, `require()`, `import`, and real disk I/O are blocked. A deterministic `path` shim and a read-only virtual `fs` (`context.content`) exist, while `fs` write calls throw `VALIDATION_ERROR`. Pass file contents or external markdown via `context` (accessible inside JS code as `context` or `ctx`).
- **Globals:** `createEntry()`, `find()`, `recent()`, `searchEntries()`, `deleteEntry()`, `help()` work without the `mj.` prefix.
- **Positional Arguments:** `createEntry("note")`, `searchEntries("performance")`, `mj.backup.backupJournal("snapshot")`.
- **Anchors:** Attach code/file `anchors` directly on `mj.core.createEntry` when referencing source files (parameter alias healing is summarized under `Aliases:` in the server instructions).
- **Arrays & Methods:** Proxies seamlessly support native array properties/methods (e.g., `.length`, `[0]`, `.map()`, `.filter()`, `.includes()`, `.shift()`, `.concat()`). Calling an unsupported method returns an actionable `VALIDATION_ERROR` rather than crashing.
- **Async/Await:** Do NOT access `Promise` objects synchronously. Always `await` async operations. Missing `await` statements will be intercepted and return an actionable `VALIDATION_ERROR`.
- **SQL Translation & Auto-Healing:** Code Mode executes JavaScript via the `mj.*` API. If raw SQL statements are passed against the `memory_journal` table (e.g., `SELECT * FROM memory_journal LIMIT 10`), the server translates them to `mj.core.getRecentEntries({ limit: 10 })` or `mj.search.searchEntries({ query: "..." })`. Prefer `mj.*` methods directly.
- **Direct SQLite & Prepared Statements:** Do NOT execute direct SQLite statements or driver preparations (e.g. `const db = mj.getDatabase(); db.prepare(...)`). Use high-level `mj.*` API calls instead: `mj.admin.updateEntry({ entry_id: ..., content: ... })` to update entries, and `mj.core.createEntry({ ... })` to insert entries. The sandbox automatically translates prepared statement updates and queries into safe `mj.*` method invocations.
- **Template Literals & Backticks:** When passing multi-line strings or markdown with embedded backticks (e.g. inline code blocks like `` `.npmrc` ``), avoid raw unescaped backticks inside a template literal. Either escape them (`\```) or pass the string safely via the `context` parameter and access it as `context.myContent`.
- **Quotes & Escaping:** When passing strings with single quotes, double quotes, or backticks in Code Mode, avoid double-escaping backslashes (e.g. `\\'` or `\\"`), which prematurely terminates string literals in JavaScript. Pass complex content safely via `context.content`.
- **Payload Objects & Raw JSON:** When calling Code Mode, structured dictionary objects (via `payload`, `entry`, or as a raw JSON string in `code`) containing task summaries, notes, changes, status, or action directives (e.g., `{ action: "create", task: "...", changes: [...], notes: "..." }`) are automatically translated and synthesized into type-safe `mj.core.createEntry(...)` or `mj.admin.updateEntry(...)` calls.
- **Result Size Cap & Auto-Compaction:** By default, Code Mode enforces a 100KB result serialization boundary to protect LLM context windows. For large datasets or multi-entry queries, pass `max_result_size: <bytes>` (e.g. `200 * 1024` or `500 * 1024`, up to 50MB) in `mj_execute_code` parameters or context. When structured results exceed the limit, the sandbox automatically compacts oversized markdown content and long arrays so execution succeeds seamlessly.

## API Namespace Map

### `mj.core`
- `createEntry(params)`
- `getEntryById(params)`
- `getRecentEntries(params)`
- `getEntryHistory(params)`
- `listTags(params)`
- `markAnchorsStale(params)`

### `mj.search`
- `searchEntries(params)`
- `searchByDateRange(params)`
- `semanticSearch(params)`
- `getVectorIndexStats(params)`
- `listDeletedEntries(params)`
- `crossTeamSearch(params)`

### `mj.analytics`
- `getStatistics(params)` (or `getStats()`)
- `getCrossProjectInsights(params)` (or `getInsights()`)

### `mj.relationships`
- `linkEntries(params)`
- `visualizeRelationships(params)`

### `mj.io`
- `exportEntries(params)`
- `exportMarkdown(params)`
- `importMarkdown(params)`
- `importExternal(params)`

### `mj.admin`
- `updateConfiguration(params)`
- `registerProject(params)`
- `updateProject(params)`
- `deleteProject(params)`
- `getProject(params)`
- `listProjects(params)`
- `updateEntry(params)`
- `deleteEntry(params)`
- `restoreEntry(params)`
- `rebuildVectorIndex(params)`
- `addToVectorIndex(params)`
- `mergeTags(params)`
- `batchCreateEntries(params)`
- `batchUpdateEntries(params)`
- `batchDeleteEntries(params)`
- `runAutoPrune(params)`
- `searchAuditLog(params)`

### `mj.github`
- `getGithubIssues(params)`
- `getGithubPrs(params)`
- `getGithubIssue(params)`
- `getGithubPr(params)`
- `getGithubContext(params)`
- `getKanbanBoard(params)`
- `moveKanbanItem(params)`
- `addKanbanItem(params)`
- `deleteKanbanItem(params)`
- `createGithubIssueWithEntry(params)`
- `closeGithubIssueWithEntry(params)`
- `getGithubMilestones(params)`
- `getGithubMilestone(params)`
- `createGithubMilestone(params)`
- `updateGithubMilestone(params)`
- `deleteGithubMilestone(params)`
- `getRepoInsights(params)`
- `getCopilotReviews(params)`

### `mj.git`
- `getCommitHistory(params)`
- `searchCommits(params)`
- `getReleaseInfo(params)`
- `getUnreleasedCommits(params)`
- `analyzeCommitPatterns(params)`
- `checkEntryStaleness(params)`

### `mj.backup`
- `backupJournal(params)`
- `listBackups(params)`
- `restoreBackup(params)`
- `cleanupBackups(params)`

### `mj.team`
- `teamCreateEntry(params)`, `teamGetEntryById(params)` (or `read()`), `teamGetRecent(params)`, `teamListTags(params)`
- `teamSearch(params)`, `teamSearchByDateRange(params)`, `teamSemanticSearch(params)`
- `teamUpdateEntry(params)`, `teamDeleteEntry(params)`, `teamRestoreEntry(params)`, `teamListDeletedEntries(params)` (or `trash()`)
- `teamMergeTags(params)`, `teamLinkEntries(params)`, `teamVisualizeRelationships(params)`
- `teamBatchCreateEntries(params)`, `teamBatchUpdateEntries(params)`, `teamBatchDeleteEntries(params)`
- `teamGetStatistics(params)` (or `stats()`), `teamGetCrossProjectInsights(params)`, `teamGetCollaborationMatrix(params)`
- `teamExportEntries(params)` (or `export()`), `teamExportMarkdown(params)`, `teamImportMarkdown(params)` (or `importMd()`), `teamImportExternal(params)`
- `teamBackup(params)`, `teamListBackups(params)`
- `teamGetVectorIndexStats(params)`, `teamRebuildVectorIndex(params)`, `teamAddToVectorIndex(params)`
- `teamAddMember(params)`, `teamRemoveMember(params)`, `teamUpdateMemberRole(params)`, `teamListMembers(params)`, `teamGetMember(params)`
- `teamAddAuthorAlias(params)`, `teamRemoveAuthorAlias(params)`, `teamListAuthorAliases(params)`, `teamResolveAuthor(params)`, `teamConsolidateAuthors(params)`

**Rule:** When `mj_execute_code` is the only registered tool (e.g., Code Mode), all tool actions must be performed using the `mj.*` namespaces listed above inside the code sandbox. Do NOT attempt to call the original tool names as direct MCP operations. CLI commands are exempt from this and should be run in the terminal.