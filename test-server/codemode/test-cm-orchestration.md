# Test memory-journal-mcp — Code Mode: Cross-Group Orchestration

Test cross-group orchestration: journal health dashboards, GitHub-journal coverage, tag analysis pipelines, relationship graph summaries, and full create→index→search pipelines.

**Scope:** 1 tool (`mj_execute_code`), Phase 23 — ~5 test cases simulating real agent workflows that span multiple API groups.

**Prerequisites:**

- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 23: Cross-Group Orchestration

> [!TIP]
> These tests simulate real agent workflows that span multiple API groups in a single Code Mode execution — the primary use case for token savings.

### 23.1 Journal Health Dashboard

```javascript
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
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
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
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
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
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
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
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
// Test code (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
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

## Success Criteria

- [x] Journal health dashboard aggregates stats + recent + tags correctly
- [x] GitHub-journal coverage report iterates issues and searches entries
- [x] Tag analysis pipeline processes multiple tags with search per tag
- [x] Relationship graph summary checks entries for relationship counts
- [x] Full pipeline (create → index → semantic search) completes end-to-end
