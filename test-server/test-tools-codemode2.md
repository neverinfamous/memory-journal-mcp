# Test memory-journal-mcp — Pass 4: Code Mode Advanced

Test multi-step workflows, cross-group orchestration, and the remaining tool groups (relationships, GitHub, admin/backup/export, team) through Code Mode.

**Scope:** ~55 test scenarios across 6 phases (Phases 22-27) covering multi-step pipelines, cross-group orchestration, relationships, GitHub (16 tools), admin/backup/export, and team tools — all via Code Mode.

**Prerequisites:**

- Pass 3 (`test-tools-codemode.md`) must pass first — sandbox, security, core CRUD, and search verified.
- Pass 1 seed data (S1-S12) must exist.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.
- Use https://github.com/users/neverinfamous/projects/5 for project/Kanban testing.

**Workflow after testing:**

1. Create a plan to fix any issues found, including changes to `server-instructions.md`/`server-instructions.ts` or this file (`test-server/test-tools-codemode2.md`).
2. If the plan requires no user decisions, proceed with implementation immediately.
3. After implementation: run `npm run lint && npm run typecheck`, fix any issues, run `npx vitest run`, fix broken tests, update `UNRELEASED.md`, and commit without pushing.
4. Re-test fixes with direct MCP calls.
5. Provide a final summary — after re-testing if fixes were needed, or immediately if no issues were found.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Read `memory://briefing` to confirm context loaded (the briefing table confirms receipt).

---

## Phase 22: Multi-Step Workflows

### 22.1 Read-Only Pipelines

| Test                    | Code                                                                                                                                                                                                                                                                                                                      | Expected Result                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Stats + recent summary  | `const stats = await mj.analytics.getStatistics({}); const recent = await mj.core.getRecentEntries({limit: 3}); return { total: stats.totalEntries, recentCount: recent.entries.length };`                                                                                                                                | Both fields populated             |
| Search + count          | `const results = await mj.search.searchEntries({query: "test", limit: 5}); return { matchCount: results.entries.length, query: "test" };`                                                                                                                                                                                 | `matchCount` ≥ 0, `query: "test"` |
| Recent + tag extraction | `const r = await mj.core.getRecentEntries({limit: 10}); const tags = r.entries.flatMap(e => e.tags \|\| []); const counts = {}; for (const t of tags) { counts[t] = (counts[t] \|\| 0) + 1; } return { uniqueTags: Object.keys(counts).length, topTags: Object.entries(counts).sort(([,a],[,b]) => b - a).slice(0, 5) };` | `uniqueTags` ≥ 0, `topTags` array |

### 22.2 Conditional Branching

| Test                 | Code                                                                                                                                                                                | Expected Result                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Conditional on stats | `const s = await mj.analytics.getStatistics({}); if (s.totalEntries > 0) { return { status: "has entries", count: s.totalEntries }; } else { return { status: "empty journal" }; }` | Returns either branch based on data |
| Loop over entries    | `const r = await mj.core.getRecentEntries({limit: 5}); const summaries = r.entries.map(e => ({ id: e.id, type: e.entry_type, len: e.content?.length ?? 0 })); return summaries;`    | Array of summary objects            |

### 22.3 Create + Read Round-Trip (via Code Mode)

| Test               | Code                                                                                                                                                                                                                                                                                        | Expected Result                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Create + read back | `const created = await mj.core.createEntryMinimal({content: "Code Mode round-trip test"}); const fetched = await mj.core.getEntryById({entry_id: created.entry.id}); return { createdId: created.entry.id, fetchedContent: fetched.entry.content };`                                        | `fetchedContent` matches "Code Mode round-trip test" |
| Create + search    | `const created = await mj.core.createEntry({content: "CodeMode search marker XYZ789", tags: ["codemode-test"]}); const found = await mj.search.searchEntries({query: "CodeMode search marker XYZ789", limit: 1}); return { found: found.entries.length > 0, createdId: created.entry.id };` | `found: true`                                        |

---

## Phase 23: Cross-Group Orchestration

> [!TIP]
> These tests simulate real agent workflows that span multiple API groups in a single Code Mode execution — the primary use case for token savings.

### 23.1 Journal Health Dashboard

```javascript
// Test code:
const stats = await mj.analytics.getStatistics({})
const recent = await mj.core.getRecentEntries({ limit: 5 })
const tags = await mj.core.listTags({})
return {
  totalEntries: stats.totalEntries,
  recentTitles: recent.entries.map((e) => e.title || e.content?.substring(0, 50)),
  tagCount: tags.tags?.length ?? 0,
  healthStatus: stats.totalEntries > 0 ? 'healthy' : 'empty',
}
```

| Check          | Expected         |
| -------------- | ---------------- |
| `totalEntries` | Number > 0       |
| `recentTitles` | Array of strings |
| `tagCount`     | Number ≥ 0       |
| `healthStatus` | `"healthy"`      |

### 23.2 GitHub-Journal Coverage Report

```javascript
// Test code:
const issues = await mj.github.getGithubIssues({ limit: 3 })
const results = []
for (const issue of (issues.issues || []).slice(0, 2)) {
  const entries = await mj.search.searchEntries({
    query: `#${issue.number}`,
    limit: 3,
  })
  results.push({
    issue: `#${issue.number}: ${issue.title}`,
    linkedEntries: entries.entries.length,
  })
}
return { issueCount: issues.issues?.length ?? 0, coverage: results }
```

| Check        | Expected                                        |
| ------------ | ----------------------------------------------- |
| `issueCount` | Number ≥ 0                                      |
| `coverage`   | Array with `issue` and `linkedEntries` per item |

### 23.3 Tag Analysis Pipeline

```javascript
// Test code:
const tagList = await mj.core.listTags({})
const topTags = (tagList.tags || []).sort((a, b) => b.count - a.count).slice(0, 3)
const report = []
for (const tag of topTags) {
  const entries = await mj.search.searchEntries({ query: tag.name, limit: 2 })
  report.push({ tag: tag.name, count: tag.count, sampleEntries: entries.entries.length })
}
return { analyzedTags: report.length, report }
```

| Check          | Expected                                            |
| -------------- | --------------------------------------------------- |
| `analyzedTags` | Number ≥ 0                                          |
| `report`       | Array with `tag`, `count`, `sampleEntries` per item |

### 23.4 Relationship Graph Summary

```javascript
// Test code:
const recent = await mj.core.getRecentEntries({ limit: 5 })
const withRelationships = []
for (const entry of recent.entries.slice(0, 3)) {
  const detail = await mj.core.getEntryById({ entry_id: entry.id })
  const relCount = detail.entry?.relationships?.length ?? 0
  if (relCount > 0) {
    withRelationships.push({ id: entry.id, relationships: relCount })
  }
}
return { checked: Math.min(recent.entries.length, 3), withRelationships }
```

| Check               | Expected                                       |
| ------------------- | ---------------------------------------------- |
| `checked`           | Number (1-3)                                   |
| `withRelationships` | Array (may be empty if no relationships exist) |

### 23.5 Full Pipeline: Create → Index → Search

> [!CAUTION]
> This test creates a real entry and modifies the vector index.

```javascript
// Test code:
const entry = await mj.core.createEntry({
  content: 'Code Mode pipeline test: semantic indexing verification ZQJKM',
  tags: ['codemode-pipeline-test'],
  entry_type: 'technical_note',
})
await mj.admin.addToVectorIndex({ entry_id: entry.entry.id })
const found = await mj.search.semanticSearch({
  query: 'semantic indexing verification',
  limit: 5,
})
const match = found.entries?.some((e) => e.id === entry.entry.id)
return {
  createdId: entry.entry.id,
  indexed: true,
  foundInSemantic: match,
  totalResults: found.entries?.length ?? 0,
}
```

| Check             | Expected                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `createdId`       | Number                                                                                                |
| `foundInSemantic` | `true` or `false` — may be `false` due to vector indexing latency within a single Code Mode execution |
| `totalResults`    | ≥ 1                                                                                                   |

---

## Phase 24: Relationships & Visualization via Code Mode

### 24.1 Link Entries — All Relationship Types

```javascript
// Test code:
const r = await mj.core.getRecentEntries({ limit: 4 })
const ids = r.entries.map((e) => e.id)
if (ids.length < 4) return { error: 'Need at least 4 entries' }

const ref = await mj.relationships.linkEntries({
  from_entry_id: ids[0],
  to_entry_id: ids[1],
  relationship_type: 'references',
})
const impl = await mj.relationships.linkEntries({
  from_entry_id: ids[0],
  to_entry_id: ids[2],
  relationship_type: 'implements',
  description: 'Implements the spec',
})
const blocked = await mj.relationships.linkEntries({
  from_entry_id: ids[0],
  to_entry_id: ids[3],
  relationship_type: 'blocked_by',
})
const resolved = await mj.relationships.linkEntries({
  from_entry_id: ids[1],
  to_entry_id: ids[2],
  relationship_type: 'resolved',
})
const caused = await mj.relationships.linkEntries({
  from_entry_id: ids[2],
  to_entry_id: ids[3],
  relationship_type: 'caused',
})
return {
  refSuccess: ref.success,
  implSuccess: impl.success,
  implHasDesc: !!impl.relationship?.description,
  blockedSuccess: blocked.success,
  resolvedSuccess: resolved.success,
  causedSuccess: caused.success,
  entryIds: ids,
}
```

| Check          | Expected |
| -------------- | -------- |
| All `*Success` | `true`   |
| `implHasDesc`  | `true`   |

### 24.2 Link Entries — Duplicate & Error Paths

```javascript
// Test code (run after 24.1):
const r = await mj.core.getRecentEntries({ limit: 2 })
const [a, b] = r.entries.map((e) => e.id)

const dup = await mj.relationships.linkEntries({
  from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
})
const reverse = await mj.relationships.linkEntries({
  from_entry_id: b,
  to_entry_id: a,
  relationship_type: 'references',
})
const badSource = await mj.relationships.linkEntries({
  from_entry_id: 999999,
  to_entry_id: b,
  relationship_type: 'references',
})
const badTarget = await mj.relationships.linkEntries({
  from_entry_id: a,
  to_entry_id: 999999,
  relationship_type: 'references',
})
return {
  dupDetected: dup.duplicate === true,
  dupHasMessage: !!dup.message,
  reverseSuccess: reverse.success,
  badSourceFailed: badSource.success === false,
  badTargetFailed: badTarget.success === false,
}
```

| Check             | Expected                           |
| ----------------- | ---------------------------------- |
| `dupDetected`     | `true`                             |
| `reverseSuccess`  | `true` (reverse direction allowed) |
| `badSourceFailed` | `true`                             |
| `badTargetFailed` | `true`                             |

### 24.3 Visualize Relationships

```javascript
// Test code:
const r = await mj.core.getRecentEntries({ limit: 1 })
const id = r.entries[0].id

const viz = await mj.relationships.visualizeRelationships({ entry_id: id })
const vizTags = await mj.relationships.visualizeRelationships({ tags: ['architecture'] })
const vizDeep = await mj.relationships.visualizeRelationships({ entry_id: id, depth: 3 })
const vizLimit = await mj.relationships.visualizeRelationships({ entry_id: id, limit: 5 })
const vizBad = await mj.relationships.visualizeRelationships({ entry_id: 999999 })
return {
  hasMermaid: typeof viz.mermaid === 'string' && viz.mermaid.length > 0,
  hasLegend: !!viz.legend,
  entryCount: viz.entry_count,
  relCount: viz.relationship_count,
  tagVizHasMermaid: typeof vizTags.mermaid === 'string',
  deepEntryCount: vizDeep.entry_count,
  limitEntryCount: vizLimit.entry_count,
  badNotFound: !!vizBad.message && vizBad.message.includes('not found'),
}
```

| Check         | Expected |
| ------------- | -------- |
| `hasMermaid`  | `true`   |
| `hasLegend`   | `true`   |
| `entryCount`  | ≥ 1      |
| `badNotFound` | `true`   |

---

## Phase 25: GitHub Tools via Code Mode (16 tools)

> [!CAUTION]
> Phase 25.3–25.4 create and modify **real GitHub issues and milestones**. Clean up after testing.

### 25.1 Read-Only GitHub Tools

```javascript
// Test code:
const ctx = await mj.github.getGithubContext({})
const issues = await mj.github.getGithubIssues({ limit: 3 })
const closedIssues = await mj.github.getGithubIssues({ state: 'closed', limit: 2 })
const prs = await mj.github.getGithubPrs({ limit: 3 })
const closedPrs = await mj.github.getGithubPrs({ state: 'closed', limit: 2 })
const milestones = await mj.github.getGithubMilestones({})

// Single-item lookups (use known numbers from context)
const issueNum = issues.issues?.[0]?.number
const prNum = prs.pullRequests?.[0]?.number ?? closedPrs.pullRequests?.[0]?.number
const singleIssue = issueNum ? await mj.github.getGithubIssue({ issue_number: issueNum }) : null
const singlePr = prNum ? await mj.github.getGithubPr({ pr_number: prNum }) : null

return {
  contextHasRepo: !!ctx.repoName,
  contextHasBranch: !!ctx.branch,
  issueCount: issues.count,
  issueMilestoneField: typeof issues.issues?.[0]?.milestone,
  closedIssueCount: closedIssues.count,
  prCount: prs.count,
  closedPrCount: closedPrs.count,
  milestoneCount: milestones.count,
  singleIssueHasBody: !!singleIssue?.issue?.body !== undefined,
  singlePrHasDraft: singlePr?.pullRequest?.draft !== undefined,
}
```

| Check              | Expected |
| ------------------ | -------- |
| `contextHasRepo`   | `true`   |
| `contextHasBranch` | `true`   |
| `issueCount`       | ≥ 0      |
| `milestoneCount`   | ≥ 0      |

### 25.2 GitHub Error Paths

| Test                  | Code                                                                       | Expected Result                            |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| Nonexistent issue     | `return await mj.github.getGithubIssue({ issue_number: 999999 });`         | `{ error: "Issue #999999 not found" }`     |
| Nonexistent PR        | `return await mj.github.getGithubPr({ pr_number: 999999 });`               | `{ error: "PR #999999 not found" }`        |
| Nonexistent milestone | `return await mj.github.getGithubMilestone({ milestone_number: 999999 });` | `{ error: "Milestone #999999 not found" }` |
| Nonexistent Kanban    | `return await mj.github.getKanbanBoard({ project_number: 99999 });`        | Structured error with project not found    |

### 25.3 Kanban Tools

```javascript
// Test code:
const board = await mj.github.getKanbanBoard({ project_number: 5 })
const hasItems = board.columns?.some((c) => c.items?.length > 0)
const itemId = board.columns?.flatMap((c) => c.items ?? []).find((i) => i)?.id

let moveResult = null
if (itemId) {
  moveResult = await mj.github.moveKanbanItem({
    project_number: 5,
    item_id: itemId,
    target_status: 'In progress',
  })
}

const badMove = await mj.github.moveKanbanItem({
  project_number: 5,
  item_id: itemId || 'fake-id',
  target_status: 'Nonexistent Status',
})

return {
  boardHasColumns: Array.isArray(board.columns),
  statusOptions: board.statusOptions,
  hasItems,
  moveSuccess: moveResult?.success,
  badMoveError: badMove.success === false,
  badMoveHasStatuses: Array.isArray(badMove.availableStatuses),
}
```

| Check                | Expected                |
| -------------------- | ----------------------- |
| `boardHasColumns`    | `true`                  |
| `statusOptions`      | Array of valid statuses |
| `moveSuccess`        | `true` (if items exist) |
| `badMoveError`       | `true`                  |
| `badMoveHasStatuses` | `true`                  |

### 25.4 Issue Lifecycle & Milestone CRUD

> [!CAUTION]
> Creates and closes real GitHub issues and milestones. Clean up in Phase 25.6.

```javascript
// Test code — Issue Lifecycle:
const created = await mj.github.createGithubIssueWithEntry({
  title: 'CM4 Test: Code Mode Issue',
  body: 'Created via Code Mode test',
  labels: ['test'],
  project_number: 5,
  tags: ['codemode4-test'],
})
const issueNum = created.issue?.number

const closed = await mj.github.closeGithubIssueWithEntry({
  issue_number: issueNum,
  resolution_notes: 'CM4 test complete',
  comment: 'Closing via Code Mode',
  move_to_done: true,
  project_number: 5,
})

const alreadyClosed = await mj.github.closeGithubIssueWithEntry({
  issue_number: issueNum,
})

return {
  createSuccess: created.success,
  issueNumber: issueNum,
  hasJournal: !!created.journalEntry,
  hasProject: !!created.project,
  closeSuccess: closed.success,
  closeHasKanban: !!closed.kanban,
  kanbanMoved: closed.kanban?.moved,
  alreadyClosedError: alreadyClosed.success === false,
  alreadyClosedMsg: alreadyClosed.error,
}
```

| Check                | Expected |
| -------------------- | -------- |
| `createSuccess`      | `true`   |
| `hasJournal`         | `true`   |
| `closeSuccess`       | `true`   |
| `kanbanMoved`        | `true`   |
| `alreadyClosedError` | `true`   |

```javascript
// Test code — Milestone CRUD:
const ms = await mj.github.createGithubMilestone({
  title: 'CM4 Test Milestone',
  description: 'Created via Code Mode',
  due_on: '2026-12-31',
})
const msNum = ms.milestone?.number

const updated = await mj.github.updateGithubMilestone({
  milestone_number: msNum,
  description: 'Updated via Code Mode',
})

const closed = await mj.github.updateGithubMilestone({
  milestone_number: msNum,
  state: 'closed',
})

const detail = await mj.github.getGithubMilestone({
  milestone_number: msNum,
})

const deleted = await mj.github.deleteGithubMilestone({
  milestone_number: msNum,
  confirm: true,
})

return {
  createSuccess: ms.success,
  msNumber: msNum,
  updateSuccess: updated.success,
  closeSuccess: closed.success,
  detailState: detail.milestone?.state,
  deleteSuccess: deleted.success,
}
```

| Check           | Expected   |
| --------------- | ---------- |
| `createSuccess` | `true`     |
| `updateSuccess` | `true`     |
| `detailState`   | `"closed"` |
| `deleteSuccess` | `true`     |

### 25.5 Repo Insights & Copilot Reviews

```javascript
// Test code:
const stars = await mj.github.getRepoInsights({})
const traffic = await mj.github.getRepoInsights({ sections: 'traffic' })
const all = await mj.github.getRepoInsights({ sections: 'all' })

// Copilot reviews (use a known PR number)
const reviewed = await mj.github.getCopilotReviews({ pr_number: 1 })

return {
  hasStars: typeof stars.stars === 'number',
  hasForks: typeof stars.forks === 'number',
  trafficHasClones: traffic.traffic?.clones !== undefined || traffic.error !== undefined,
  allSections: !!all,
  reviewState: reviewed.state,
  reviewComments: reviewed.commentCount,
}
```

| Check         | Expected                              |
| ------------- | ------------------------------------- |
| `hasStars`    | `true`                                |
| `hasForks`    | `true`                                |
| `reviewState` | String (`"none"`, `"approved"`, etc.) |

### 25.6 GitHub Cleanup

> [!IMPORTANT]
> Run after all Phase 25 tests. Check for any unclosed test issues or milestones.

| Cleanup Step      | Code                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verify no orphans | `const b = await mj.github.getKanbanBoard({ project_number: 5 }); const testItems = b.columns?.flatMap(c => c.items ?? []).filter(i => i.title?.includes("CM4")); return { orphans: testItems?.length ?? 0 };` |

---

## Phase 26: Admin, Backup & Export via Code Mode

### 26.1 Tag Management

```javascript
// Test code:
const tags = await mj.core.listTags({})
const hasEntries = tags.tags?.length > 0

// Create source tag for merge
await mj.core.createEntry({ content: 'CM4 merge test entry', tags: ['cm4-old-tag'] })
const merged = await mj.admin.mergeTags({
  source_tag: 'cm4-old-tag',
  target_tag: 'cm4-new-tag',
})
const afterMerge = await mj.core.listTags({})
const oldGone = !afterMerge.tags?.some((t) => t.name === 'cm4-old-tag')
const newExists = afterMerge.tags?.some((t) => t.name === 'cm4-new-tag')

// Error paths
const sameMerge = await mj.admin.mergeTags({
  source_tag: 'cm4-new-tag',
  target_tag: 'cm4-new-tag',
})
const nonexistentMerge = await mj.admin.mergeTags({
  source_tag: 'nonexistent-xyz-cm4',
  target_tag: 'test',
})

return {
  tagCount: tags.tags?.length ?? 0,
  mergeSuccess: merged.success,
  entriesUpdated: merged.entriesUpdated,
  oldTagGone: oldGone,
  newTagExists: newExists,
  sameTagError: sameMerge.success === false,
  nonexistentError: nonexistentMerge.success === false,
}
```

| Check              | Expected |
| ------------------ | -------- |
| `mergeSuccess`     | `true`   |
| `oldTagGone`       | `true`   |
| `newTagExists`     | `true`   |
| `sameTagError`     | `true`   |
| `nonexistentError` | `true`   |

### 26.2 Export

```javascript
// Test code:
const jsonExport = await mj.export.exportEntries({ format: 'json', limit: 5 })
const mdExport = await mj.export.exportEntries({ format: 'markdown', limit: 5 })
const tagExport = await mj.export.exportEntries({
  format: 'json',
  tags: ['architecture'],
  limit: 10,
})
const dateExport = await mj.export.exportEntries({
  format: 'json',
  start_date: '2026-01-01',
  end_date: '2026-03-01',
})
const typeExport = await mj.export.exportEntries({
  format: 'json',
  entry_types: ['planning'],
  limit: 10,
})
return {
  jsonHasEntries: Array.isArray(jsonExport.entries),
  jsonCount: jsonExport.entries?.length ?? 0,
  mdHasContent: typeof mdExport.content === 'string',
  tagFiltered:
    tagExport.entries?.every(
      (e) => e.tags?.includes('architecture') || e.tags?.some((t) => t === 'architecture')
    ) ?? false,
  dateFiltered: dateExport.entries?.length >= 0,
  typeFiltered: typeExport.entries?.every((e) => e.entryType === 'planning') ?? true,
}
```

| Check            | Expected                                      |
| ---------------- | --------------------------------------------- |
| `jsonHasEntries` | `true`                                        |
| `mdHasContent`   | `true`                                        |
| `tagFiltered`    | `true` (only entries with "architecture" tag) |
| `typeFiltered`   | `true` (only "planning" type)                 |

### 26.3 Backup & Restore

```javascript
// Test code:
const named = await mj.backup.backupJournal({ name: 'cm4-test-backup' })
const auto = await mj.backup.backupJournal({})
const list = await mj.backup.listBackups({})

// Path traversal
const traversal = await mj.backup.backupJournal({ name: '../../etc/passwd' })

// Restore
const restored = await mj.backup.restoreBackup({
  filename: named.filename,
  confirm: true,
})

// Restore nonexistent
const badRestore = await mj.backup.restoreBackup({
  filename: 'nonexistent-cm4.db',
  confirm: true,
})

// Cleanup
const cleanup = await mj.backup.cleanupBackups({ keep_count: 5 })

return {
  namedSuccess: named.success,
  namedFilename: named.filename,
  namedHasPath: !!named.path,
  namedHasSize: typeof named.sizeBytes === 'number',
  autoSuccess: auto.success,
  listTotal: list.total,
  traversalBlocked: traversal.success === false,
  restoreSuccess: restored.success,
  restoreHasReverted: !!restored.revertedChanges,
  badRestoreError: badRestore.success === false,
  cleanupSuccess: cleanup.success,
}
```

| Check              | Expected |
| ------------------ | -------- |
| `namedSuccess`     | `true`   |
| `namedHasPath`     | `true`   |
| `namedHasSize`     | `true`   |
| `autoSuccess`      | `true`   |
| `traversalBlocked` | `true`   |
| `restoreSuccess`   | `true`   |
| `badRestoreError`  | `true`   |
| `cleanupSuccess`   | `true`   |

---

## Phase 27: Team Tools & Error Paths via Code Mode

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured. If not configured, all team tools should return structured `{ success: false, error: "Team database not configured..." }`.
>
> **`team_delete_entry` is soft-delete only** — no `permanent` flag.

### 27.1 Team CRUD

```javascript
// Test code:
const created = await mj.team.teamCreateEntry({
  content: 'CM4 team entry test',
  tags: ['codemode4-team-test'],
  entry_type: 'standup',
})
const withAuthor = await mj.team.teamCreateEntry({
  content: 'CM4 team explicit author',
  author: 'CM4Bot',
})
const recent = await mj.team.teamGetRecent({ limit: 5 })
const search = await mj.team.teamSearch({ query: 'CM4 team entry test' })
const tagSearch = await mj.team.teamSearch({ tags: ['codemode4-team-test'] })
const combined = await mj.team.teamSearch({
  query: 'team',
  tags: ['codemode4-team-test'],
})
const noArgs = await mj.team.teamSearch({})

// New: get by ID, list tags
const detail = await mj.team.teamGetEntryById({ entry_id: created.entry.id })
const detailNoRels = await mj.team.teamGetEntryById({
  entry_id: created.entry.id,
  include_relationships: false,
})
const tags = await mj.team.teamListTags({})

return {
  createSuccess: created.success,
  createAuthor: created.entry?.author,
  explicitAuthor: withAuthor.entry?.author,
  recentCount: recent.entries?.length ?? 0,
  recentHasAuthor: !!recent.entries?.[0]?.author,
  searchCount: search.entries?.length ?? 0,
  tagSearchCount: tagSearch.entries?.length ?? 0,
  combinedCount: combined.entries?.length ?? 0,
  noArgsCount: noArgs.entries?.length ?? 0,
  detailHasEntry: !!detail.entry,
  detailHasImportance: !!detail.importance,
  detailNoRelsEmpty: !detailNoRels.relationships?.length,
  tagCount: tags.tags?.length ?? 0,
}
```

| Check             | Expected                          |
| ----------------- | --------------------------------- |
| `createSuccess`   | `true`                            |
| `createAuthor`    | Non-empty string (auto-populated) |
| `explicitAuthor`  | `"CM4Bot"`                        |
| `recentHasAuthor` | `true`                            |
| `searchCount`     | ≥ 1                               |
| `tagSearchCount`  | ≥ 1                               |
| `detailHasEntry`  | `true`                            |
| `tagCount`        | ≥ 1                               |

### 27.2 Team Error Paths

| Test               | Code                                                                                | Expected Result                    |
| ------------------ | ----------------------------------------------------------------------------------- | ---------------------------------- |
| Invalid entry_type | `return await mj.team.teamCreateEntry({ content: "test", entry_type: "invalid" });` | `{ success: false, error: "..." }` |
| Nonexistent get    | `return await mj.team.teamGetEntryById({ entry_id: 999999 });`                      | `{ success: false, error: "..." }` |
| Nonexistent update | `return await mj.team.teamUpdateEntry({ entry_id: 999999, content: "x" });`         | `{ success: false, error: "..." }` |
| Nonexistent delete | `return await mj.team.teamDeleteEntry({ entry_id: 999999 });`                       | `{ success: false, error: "..." }` |
| Invalid date range | `return await mj.team.teamSearchByDateRange({ start_date: "Jan 1", end_date: "Jan 31" });` | `{ success: false, error: "..." }` |
| Merge same tag     | `return await mj.team.teamMergeTags({ source_tag: "x", target_tag: "x" });`         | `{ success: false, error: "..." }` |
| Link nonexistent   | `return await mj.team.teamLinkEntries({ from_entry_id: 999999, to_entry_id: 1, relationship_type: "references" });` | `{ success: false, error: "..." }` |

### 27.3 Team Date Range Search

```javascript
// Test code:
const results = await mj.team.teamSearchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
})
const typed = await mj.team.teamSearchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  entry_type: 'standup',
})
const tagged = await mj.team.teamSearchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  tags: ['codemode4-team-test'],
})
return {
  hasEntries: Array.isArray(results.entries),
  count: results.count ?? 0,
  typedFiltered: typed.entries?.every((e) => e.entryType === 'standup') ?? true,
  taggedCount: tagged.entries?.length ?? 0,
}
```

| Check           | Expected |
| --------------- | -------- |
| `hasEntries`    | `true`   |
| `typedFiltered` | `true`   |

### 27.4 Team Admin

```javascript
// Test code:
const r = await mj.team.teamGetRecent({ limit: 1 })
const id = r.entries[0].id

const updated = await mj.team.teamUpdateEntry({
  entry_id: id,
  content: 'CM4 updated team content',
  tags: ['cm4-updated-team'],
})
const verify = await mj.team.teamGetEntryById({ entry_id: id })

// Merge tags
await mj.team.teamCreateEntry({ content: 'CM4 merge source', tags: ['cm4-team-old'] })
const merged = await mj.team.teamMergeTags({
  source_tag: 'cm4-team-old',
  target_tag: 'cm4-team-new',
})
const afterTags = await mj.team.teamListTags({})
const oldGone = !afterTags.tags?.some((t) => t.name === 'cm4-team-old')
const newExists = afterTags.tags?.some((t) => t.name === 'cm4-team-new')

// Soft delete
const toDelete = await mj.team.teamCreateEntry({ content: 'CM4 delete me' })
const deleted = await mj.team.teamDeleteEntry({ entry_id: toDelete.entry.id })

return {
  updateSuccess: updated.success,
  contentUpdated: verify.entry?.content === 'CM4 updated team content',
  mergeSuccess: merged.success,
  oldTagGone: oldGone,
  newTagExists: newExists,
  deleteSuccess: deleted.success,
}
```

| Check            | Expected |
| ---------------- | -------- |
| `updateSuccess`  | `true`   |
| `contentUpdated` | `true`   |
| `mergeSuccess`   | `true`   |
| `oldTagGone`     | `true`   |
| `deleteSuccess`  | `true`   |

### 27.5 Team Analytics

```javascript
// Test code:
const stats = await mj.team.teamGetStatistics({})
const monthly = await mj.team.teamGetStatistics({ group_by: 'month' })
return {
  hasTotalEntries: typeof stats.totalEntries === 'number',
  hasEntryTypes: !!stats.entryTypes,
  hasTopTags: Array.isArray(stats.topTags),
  hasAuthors: Array.isArray(stats.authors),
  monthlyHasPeriod: typeof monthly.periodEntries === 'number',
}
```

| Check             | Expected |
| ----------------- | -------- |
| `hasTotalEntries` | `true`   |
| `hasEntryTypes`   | `true`   |
| `hasAuthors`      | `true`   |

### 27.6 Team Relationships

```javascript
// Test code:
const r = await mj.team.teamGetRecent({ limit: 2 })
const [a, b] = r.entries.map((e) => e.id)

const linked = await mj.team.teamLinkEntries({
  from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
  description: 'CM4 team link test',
})
const dup = await mj.team.teamLinkEntries({
  from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
})
const viz = await mj.team.teamVisualizeRelationships({ entry_id: a })
const vizTag = await mj.team.teamVisualizeRelationships({ tag: 'codemode4-team-test' })

return {
  linkSuccess: linked.success,
  hasDescription: !!linked.relationship?.description,
  dupDetected: dup.alreadyExists === true,
  hasMermaid: typeof viz.mermaid === 'string' && viz.mermaid.length > 0,
  nodeCount: viz.nodeCount,
  tagVizHasMermaid: typeof vizTag.mermaid === 'string',
}
```

| Check           | Expected |
| --------------- | -------- |
| `linkSuccess`   | `true`   |
| `hasDescription`| `true`   |
| `dupDetected`   | `true`   |
| `hasMermaid`    | `true`   |

### 27.7 Team Export

```javascript
// Test code:
const jsonExport = await mj.team.teamExportEntries({ format: 'json', limit: 5 })
const mdExport = await mj.team.teamExportEntries({ format: 'markdown', limit: 5 })
const tagExport = await mj.team.teamExportEntries({
  format: 'json',
  tags: ['codemode4-team-test'],
  limit: 10,
})
return {
  jsonHasData: typeof jsonExport.data === 'string',
  jsonCount: jsonExport.count ?? 0,
  mdHasData: typeof mdExport.data === 'string',
  tagFilteredCount: tagExport.count ?? 0,
}
```

| Check        | Expected |
| ------------ | -------- |
| `jsonHasData`| `true`   |
| `mdHasData`  | `true`   |
| `jsonCount`  | ≥ 1      |

### 27.8 Team Backup

```javascript
// Test code:
const named = await mj.team.teamBackup({ name: 'cm4-team-backup' })
const auto = await mj.team.teamBackup({})
const list = await mj.team.teamListBackups({})
return {
  namedSuccess: named.success,
  namedFilename: named.filename,
  namedHasPath: !!named.path,
  namedHasSize: typeof named.sizeBytes === 'number',
  autoSuccess: auto.success,
  listTotal: list.total,
  listHasBackups: Array.isArray(list.backups),
}
```

| Check            | Expected |
| ---------------- | -------- |
| `namedSuccess`   | `true`   |
| `namedHasPath`   | `true`   |
| `namedHasSize`   | `true`   |
| `autoSuccess`    | `true`   |
| `listHasBackups` | `true`   |

### 27.9 Cross-Tool Error Path Verification (via Code Mode)

> [!IMPORTANT]
> Verify that tool errors propagate as structured handler errors through the Code Mode API bridge — not as raw MCP errors or unhandled exceptions.

```javascript
// Test code — batch error path testing:
const errors = {}

// Core errors
errors.createEmpty = await mj.core.createEntry({ content: '' })
errors.getNotFound = await mj.core.getEntryById({ entry_id: 999999 })
errors.updateNotFound = await mj.admin.updateEntry({ entry_id: 999999, content: 'x' })
errors.deleteNotFound = await mj.admin.deleteEntry({ entry_id: 999999 })

// Relationship errors
errors.linkBadSource = await mj.relationships.linkEntries({
  from_entry_id: 999999,
  to_entry_id: 1,
  relationship_type: 'references',
})
errors.vizNotFound = await mj.relationships.visualizeRelationships({ entry_id: 999999 })

// GitHub errors
errors.issueNotFound = await mj.github.getGithubIssue({ issue_number: 999999 })
errors.prNotFound = await mj.github.getGithubPr({ pr_number: 999999 })
errors.msNotFound = await mj.github.getGithubMilestone({ milestone_number: 999999 })

// Backup errors
errors.restoreNotFound = await mj.backup.restoreBackup({
  filename: 'nonexistent.db',
  confirm: true,
})
errors.backupTraversal = await mj.backup.backupJournal({ name: '../../../etc/passwd' })

// Admin errors
errors.mergeNonexistent = await mj.admin.mergeTags({
  source_tag: 'nonexistent-xyz-abc',
  target_tag: 'test',
})
errors.addVectorBad = await mj.admin.addToVectorIndex({ entry_id: 999999 })

// Team errors
errors.teamGetNotFound = await mj.team.teamGetEntryById({ entry_id: 999999 })
errors.teamUpdateNotFound = await mj.team.teamUpdateEntry({ entry_id: 999999, content: 'x' })
errors.teamDeleteNotFound = await mj.team.teamDeleteEntry({ entry_id: 999999 })
errors.teamLinkBad = await mj.team.teamLinkEntries({
  from_entry_id: 999999,
  to_entry_id: 1,
  relationship_type: 'references',
})

// Verify all errors are structured (not raw throws)
const allStructured = Object.entries(errors).every(([key, val]) => {
  return (
    val &&
    typeof val === 'object' &&
    (val.success === false || val.error !== undefined || val.message?.includes('not found'))
  )
})

return {
  testedCount: Object.keys(errors).length,
  allStructured,
  details: Object.fromEntries(
    Object.entries(errors).map(([k, v]) => [
      k,
      {
        success: v.success,
        hasError: !!v.error || !!v.message,
        errorSnippet: (v.error || v.message || '')?.substring(0, 60),
      },
    ])
  ),
}
```

| Check           | Expected                                            |
| --------------- | --------------------------------------------------- |
| `testedCount`   | 17                                                  |
| `allStructured` | `true` — no raw exceptions through Code Mode bridge |

---

## Cleanup

After testing, remove all entries and backups created during Phases 22-27:

```javascript
// Cleanup code:
const entries = await mj.search.searchEntries({ query: 'CM4', limit: 50 })
const cm4Entries = entries.entries.filter(
  (e) => e.content?.includes('CM4') || e.tags?.some((t) => t.startsWith('codemode4'))
)
const results = []
for (const e of cm4Entries) {
  const del = await mj.admin.deleteEntry({ entry_id: e.id, permanent: true })
  results.push({ id: e.id, deleted: del.success })
}

// Also clean up Code Mode (Phase 22-23) entries
const cmEntries = await mj.search.searchEntries({ query: 'CodeMode', limit: 50 })
for (const e of cmEntries.entries) {
  if (
    e.content?.includes('Code Mode') &&
    (e.tags?.includes('codemode-test') || e.tags?.includes('codemode-pipeline-test'))
  ) {
    const del = await mj.admin.deleteEntry({ entry_id: e.id, permanent: true })
    results.push({ id: e.id, deleted: del.success })
  }
}

// Clean up team entries created during Phase 27
const teamEntries = await mj.team.teamSearch({ query: 'CM4', limit: 50 })
for (const e of (teamEntries.entries ?? [])) {
  if (e.content?.includes('CM4')) {
    const del = await mj.team.teamDeleteEntry({ entry_id: e.id })
    results.push({ id: e.id, source: 'team', deleted: del.success })
  }
}

return { cleaned: results.length, details: results }
```

---

## Test Execution Order

1. **Phase 22**: Multi-Step Workflows (read-only pipelines, conditional branching, create+read round-trip)
2. **Phase 23**: Cross-Group Orchestration (health dashboard, GitHub-journal coverage, tag analysis, full pipeline)
3. **Phase 24**: Relationships & Visualization (all types, duplicates, visualization variants, error paths)
4. **Phase 25**: GitHub (16 tools — context, issues, PRs, Kanban, milestones, insights, copilot + cleanup)
5. **Phase 26**: Admin, Backup & Export (tags, merge, export filters, backup lifecycle)
6. **Phase 27**: Team + Error Paths (15 team tools CRUD, admin, analytics, relationships, export, backup, cross-tool error propagation)

---

## Success Criteria

### Multi-Step Workflows (Phase 22)

- [ ] Chaining 2+ API calls in single execution works
- [ ] Data transformation (map, flatMap, sort, reduce) works on results
- [ ] Conditional branching based on query results works
- [ ] Create + read round-trip produces matching data
- [ ] Create + search finds the created entry

### Cross-Group Orchestration (Phase 23)

- [ ] Journal health dashboard aggregates stats + recent + tags correctly
- [ ] GitHub-journal coverage report iterates issues and searches entries
- [ ] Tag analysis pipeline processes multiple tags with search per tag
- [ ] Relationship graph summary checks entries for relationship counts
- [ ] Full pipeline (create → index → semantic search) completes end-to-end

### Relationships (Phase 24)

- [ ] All relationship types (`references`, `implements`, `blocked_by`, `resolved`, `caused`) create via Code Mode
- [ ] `link_entries` with `description` persists the description
- [ ] Duplicate detection returns `duplicate: true`
- [ ] Nonexistent IDs return `success: false` with descriptive message
- [ ] `visualize_relationships` returns Mermaid with legend, supports tags/depth/limit filters
- [ ] Nonexistent entry ID returns "not found" message

### GitHub (Phase 25)

- [ ] All 16 GitHub tools callable via `mj.github.*`
- [ ] `get_github_context` returns repo and branch info
- [ ] `get_github_issues` and `get_github_prs` support `state` filter (open/closed/all)
- [ ] Single issue/PR lookups return expected fields
- [ ] Nonexistent issue/PR/milestone return structured errors
- [ ] Kanban board returns columns with statusOptions
- [ ] `move_kanban_item` with invalid status returns error with `availableStatuses`
- [ ] Issue lifecycle (create → close) works end-to-end via Code Mode
- [ ] `close_github_issue_with_entry` returns error for already-closed issues
- [ ] Milestone CRUD lifecycle (create → update → close → delete) works via Code Mode
- [ ] `get_repo_insights` returns star/fork data
- [ ] `get_copilot_reviews` returns review state
- [ ] All test artifacts cleaned up

### Admin, Backup & Export (Phase 26)

- [ ] `list_tags` returns tag list via Code Mode
- [ ] `merge_tags` consolidates tags correctly — source removed, target exists
- [ ] `merge_tags` returns structured errors for same-tag and nonexistent source
- [ ] `export_entries` JSON and markdown formats work
- [ ] `export_entries` filters (`tags`, `start_date/end_date`, `entry_types`) produce filtered results
- [ ] `backup_journal` named and auto-named both succeed
- [ ] `backup_journal` path traversal blocked with structured error
- [ ] `list_backups` returns backup metadata
- [ ] `restore_backup` succeeds with `revertedChanges` field
- [ ] `restore_backup` nonexistent file returns structured error
- [ ] `cleanup_backups` deletes old backups

### Team & Error Paths (Phase 27)

- [ ] `team_create_entry` with auto-detected and explicit `author` works
- [ ] `team_get_recent` returns entries with `author` field
- [ ] `team_search` filters by text, tags, and combined
- [ ] `team_get_entry_by_id` returns entry detail with `importance` and optional `relationships`
- [ ] `team_list_tags` returns tag list from team database
- [ ] `team_search_by_date_range` filters by date range, entry_type, and tags
- [ ] `team_update_entry` updates content, tags, and entry_type
- [ ] `team_delete_entry` soft-deletes team entries
- [ ] `team_merge_tags` consolidates tags — source removed, entries re-tagged
- [ ] `team_get_statistics` returns `totalEntries`, `entryTypes`, `topTags`, `authors`
- [ ] `team_link_entries` creates relationships with duplicate detection
- [ ] `team_visualize_relationships` returns Mermaid diagram with node/edge counts
- [ ] `team_export_entries` exports JSON and markdown with filters
- [ ] `team_backup` creates named and auto-named backups
- [ ] `team_list_backups` returns backup metadata
- [ ] Invalid `entry_type` on team create returns structured error
- [ ] All 17 cross-tool error paths return structured handler errors (not raw throws) through Code Mode
- [ ] All test entries cleaned up after Phase 27
