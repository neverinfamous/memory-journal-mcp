# Code Mode API Reference

In Code Mode (`mj_execute_code`), you do NOT have native MCP tool schemas. You must orchestrate the server using the `mj.*` API inside the sandbox.

## Sandbox Environment
- **Network:** Disabled. `fetch()` throws `SandboxNetworkError`. Node network modules are stripped.
- **Globals:** `createEntry()`, `find()`, `recent()`, `searchEntries()`, `deleteEntry()`, `help()` work without the `mj.` prefix.
- **Positional Arguments:** `create("note")`, `searchEntries("performance")`, `mj.backup.backupJournal("snapshot")`.
- **Healing Aliases:** The proxy auto-heals common hallucinations (e.g., `text`→`content`, `entry`/`id`→`entry_id`, `issue_id`→`issue_number`).
- **Arrays:** GitHub proxies support native array methods on results (`.map()`, `.filter()`).

## API Namespace Map

### `mj.core`
- `createEntry(params)`
- `getEntryById(params)`
- `getRecentEntries(params)`
- `getEntryHistory(params)`
- `listTags(params)`

### `mj.search`
- `searchEntries(params)`
- `searchByDateRange(params)`
- `semanticSearch(params)`
- `getVectorIndexStats(params)`
- `listDeletedEntries(params)`
- `crossTeamSearch(params)`

### `mj.analytics`
- `getStatistics(params)`
- `getCrossProjectInsights(params)`

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
- `updateEntry(params)`
- `deleteEntry(params)`
- `restoreEntry(params)`
- `rebuildVectorIndex(params)`
- `addToVectorIndex(params)`
- `mergeTags(params)`
- `batchCreateEntries(params)`
- `batchUpdateEntries(params)`
- `batchDeleteEntries(params)`
- `searchAuditLog(params)`
- `_executeRawQueryUnsafe(params)`

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

### `mj.backup`
- `backupJournal(params)`
- `listBackups(params)`
- `restoreBackup(params)`
- `cleanupBackups(params)`

### `mj.team`
- `teamCreateEntry(params)`, `teamGetEntryById(params)`, `teamGetRecent(params)`, `teamListTags(params)`
- `teamSearch(params)`, `teamSearchByDateRange(params)`, `teamSemanticSearch(params)`
- `teamUpdateEntry(params)`, `teamDeleteEntry(params)`, `teamRestoreEntry(params)`, `teamListDeletedEntries(params)`
- `teamMergeTags(params)`, `teamLinkEntries(params)`, `teamVisualizeRelationships(params)`
- `teamBatchCreateEntries(params)`, `teamBatchUpdateEntries(params)`, `teamBatchDeleteEntries(params)`
- `teamGetStatistics(params)`, `teamGetCrossProjectInsights(params)`, `teamGetCollaborationMatrix(params)`
- `teamExportEntries(params)`, `teamExportMarkdown(params)`, `teamImportMarkdown(params)`, `teamImportExternal(params)`
- `teamBackup(params)`, `teamListBackups(params)`
- `teamGetVectorIndexStats(params)`, `teamRebuildVectorIndex(params)`, `teamAddToVectorIndex(params)`
- `teamPassFlag(params)`, `teamResolveFlag(params)`, `teamListFlags(params)`, `teamUpdateFlag(params)`, `teamGetFlagAnalytics(params)`
- `teamAddMember(params)`, `teamRemoveMember(params)`, `teamUpdateMemberRole(params)`, `teamListMembers(params)`, `teamGetMember(params)`
- `teamAddAuthorAlias(params)`, `teamRemoveAuthorAlias(params)`, `teamListAuthorAliases(params)`, `teamResolveAuthor(params)`, `teamConsolidateAuthors(params)`

**Rule:** When `mj_execute_code` is the only registered tool (e.g., Code Mode), all tool actions must be performed using the `mj.*` namespaces listed above inside the code sandbox. Do NOT attempt to call the original tool names as direct MCP operations.
