# Test memory-journal-mcp — Code Mode Part 3: Workflows & Relationships

Test multi-step workflows, cross-group orchestration, and relationships through Code Mode.

**Scope:** ~20 test scenarios across 3 phases (Phases 22-24) covering multi-step pipelines, cross-group orchestration, and relationship linking — all via Code Mode.

**Prerequisites:**

- Pass 1 and 2 must have completed successfully.
- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the user can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

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
| Loop over entries    | `const r = await mj.core.getRecentEntries({limit: 5}); const summaries = r.entries.map(e => ({ id: e.id, type: e.entryType, len: e.content?.length ?? 0 })); return summaries;`     | Array of summary objects            |

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

## Cleanup

After testing, remove all entries created during Phases 22-24:

```javascript
// Cleanup code:
const cmEntries = await mj.search.searchEntries({ query: 'CodeMode', limit: 50 })
const results = []
for (const e of cmEntries.entries) {
  if (
    e.content?.includes('Code Mode') &&
    (e.tags?.includes('codemode-test') || e.tags?.includes('codemode-pipeline-test'))
  ) {
    const del = await mj.admin.deleteEntry({ entry_id: e.id, permanent: true })
    results.push({ id: e.id, deleted: del.success })
  }
}
return { cleaned: results.length, details: results }
```

---

## Test Execution Order

1. **Phase 22**: Multi-Step Workflows (read-only pipelines, conditional branching, create+read round-trip)
2. **Phase 23**: Cross-Group Orchestration (health dashboard, GitHub-journal coverage, tag analysis, full pipeline)
3. **Phase 24**: Relationships & Visualization (all types, duplicates, visualization variants, error paths)

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
