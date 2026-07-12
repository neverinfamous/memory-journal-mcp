# Code Mode API Reference

In Code Mode (`mj_execute_code`), you do NOT have native MCP tool schemas. You must orchestrate the server using the `mj.*` API inside the sandbox.

## Sandbox Environment
- **Network:** Disabled. `fetch()` throws `SandboxNetworkError`. Node network modules are stripped.
- **Globals:** `createEntry()`, `find()`, `recent()`, `searchEntries()`, `deleteEntry()`, `help()` work without the `mj.` prefix.
- **Positional Arguments:** `create("note")`, `searchEntries("performance")`, `mj.backup.backupJournal("snapshot")`.
- **Healing Aliases:** The proxy auto-heals common hallucinations (e.g., `text`/`message`/`description`→`content`, `entry`/`id`→`entry_id`, `issue_id`→`issue_number`, `q`/`search`/`term`/`keyword`→`query`, `path`/`filepath`→`output_dir`, `keep`→`keep_count`, `user`/`assignee`→`target_user`, `severity`→`flag_type`, `version`→`expected_version`, `team`/`project`→`workspace_id`/`project_number`).
- **Arrays & Methods:** Proxies seamlessly support native array properties/methods (e.g., `.length`, `[0]`, `.map()`, `.filter()`, `.includes()`, `.shift()`, `.concat()`). Calling an unsupported method returns an actionable `VALIDATION_ERROR` rather than crashing.
- **Async/Await:** Do NOT access `Promise` objects synchronously. Always `await` async operations. Missing `await` statements will be intercepted and return an actionable `VALIDATION_ERROR`.

## API Namespace Map

### `mj.core`
- `createEntry(params)`
- `getEntryById(params)`
- `getRecentEntries(params)`
- `getEntryHistory(params)`
- `testSimple(params)`
- `testErrorHandling(params)`
- `triggerProgress(params)`
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