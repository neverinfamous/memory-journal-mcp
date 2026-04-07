# Test memory-journal-mcp — Code Mode: Search & Semantics

Test search, semantic search, date range, analytics, and vector index operations through the Code Mode `mj.*` API bridge.

**Scope:** 1 tool (`mj_execute_code`), Phase 21 — ~20 test cases covering FTS5, filters, semantic search, and analytics via Code Mode.

**Prerequisites:**

- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

---

## Phase 21: Search & Semantics via Code Mode

> [!NOTE]
> To ensure deterministic test results, execute the following setup snippet to guarantee cases for FTS5 fallback and search filters:
>
> ```javascript
> await mj.core.createEntry({
>   content: "This is a test's string with 100% coverage",
>   issue_number: 44,
>   pr_status: 'merged',
>   workflow_run_id: 12345,
>   project_number: 5,
>   is_personal: true,
> })
> ```

### 21.1 FTS5 Search Patterns

| Test            | Code                                                                                          | Expected Result                 |
| --------------- | --------------------------------------------------------------------------------------------- | ------------------------------- |
| Basic query     | `return await mj.search.searchEntries({ query: "architecture" });`                            | ≥ 2 results (S1, S11)           |
| Phrase          | `return await mj.search.searchEntries({ query: '"error handling"' });`                        | ≥ 1 result (S2)                 |
| Prefix          | `return await mj.search.searchEntries({ query: "auth*" });`                                   | ≥ 2 results (S1, S8)            |
| FTS5 NOT        | `return await mj.search.searchEntries({ query: "deploy NOT staging", mode: "fts" });`         | Returns S3 but NOT S5           |
| FTS5 OR         | `return await mj.search.searchEntries({ query: "deploy OR release", mode: "fts" });`          | ≥ 2 results (S3, S4, S5)        |
| LIKE fallback   | `return await mj.search.searchEntries({ query: "test's", mode: "fts" });`                     | ≥ 1 result (S6)                 |
| Special chars   | `return await mj.search.searchEntries({ query: "100%", mode: "fts" });`                       | ≥ 1 result (S6)                 |
| Hybrid auto     | `return await mj.search.searchEntries({ query: "how did we fix performance" });`              | Heuristic RRF triggering S7     |
| Forced semantic | `return await mj.search.searchEntries({ query: "improving performance", mode: "semantic" });` | Vector similarity bypassing FTS |

### 21.2 Search Filters

```javascript
// Test code:
const byIssue = await mj.search.searchEntries({ issue_number: 44 })
const byPr = await mj.search.searchEntries({ pr_status: 'merged' })
const byWorkflow = await mj.search.searchEntries({ workflow_run_id: 12345 })
const byProject = await mj.search.searchEntries({ project_number: 5 })
const personal = await mj.search.searchEntries({ query: 'test', is_personal: true })
const tagged = await mj.search.searchEntries({ tags: ['testing'] })
const typed = await mj.search.searchEntries({ entry_type: 'planning' })
const dated = await mj.search.searchEntries({ start_date: '2026-01-01', end_date: '2026-12-31' })
return {
  issueResults: byIssue.entries.length,
  prResults: byPr.entries.length,
  workflowResults: byWorkflow.entries.length,
  projectResults: byProject.entries.length,
  personalResults: personal.entries.length,
  taggedResults: tagged.entries.length,
  typedResults: typed.entries.length,
  datedResults: dated.entries.length,
  allPersonal: personal.entries.every((e) => e.isPersonal === true || e.is_personal === true),
}
```

| Check             | Expected |
| ----------------- | -------- |
| `issueResults`    | ≥ 1 (S7) |
| `prResults`       | ≥ 1 (S8) |
| `workflowResults` | ≥ 1 (S9) |
| `projectResults`  | ≥ 1 (S7) |
| `taggedResults`   | ≥ 1      |
| `typedResults`    | ≥ 1      |
| `datedResults`    | ≥ 1      |
| `allPersonal`     | `true`   |

### 21.3 Cross-DB Search

```javascript
// Test code:
const results = await mj.search.searchEntries({ query: 'architecture', limit: 20 })
const sources = results.entries.map((e) => e.source)
return {
  totalResults: results.entries.length,
  hasPersonal: sources.includes('personal'),
  hasTeam: sources.includes('team'),
}
```

| Check          | Expected     |
| -------------- | ------------ |
| `totalResults` | ≥ 2          |
| `hasPersonal`  | `true` (S1)  |
| `hasTeam`      | `true` (S11) |

### 21.4 Search by Date Range

```javascript
// Test code:
const basic = await mj.search.searchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
})
const withType = await mj.search.searchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  entry_type: 'planning',
})
const withTags = await mj.search.searchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  tags: ['deploy'],
})
const withPersonal = await mj.search.searchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  is_personal: true,
})
return {
  basicCount: basic.entries.length,
  typeCount: withType.entries.length,
  typeAllPlanning: withType.entries.every((e) => e.entryType === 'planning'),
  tagCount: withTags.entries.length,
  personalCount: withPersonal.entries.length,
}
```

| Check             | Expected                               |
| ----------------- | -------------------------------------- |
| `basicCount`      | ≥ 1                                    |
| `typeAllPlanning` | `true` (if any planning entries exist) |
| `tagCount`        | ≥ 1 (entries with "deploy" tag)        |
| `personalCount`   | ≥ 0                                    |

### 21.5 Search by Date Range — Error Paths

| Test                | Code                                                                                     | Expected Result                                         |
| ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Invalid date format | `return await mj.search.searchByDateRange({ start_date: "Jan 1", end_date: "Jan 31" });` | `{ success: false, error: "..." }` with YYYY-MM-DD hint |

### 21.6 Semantic Search

```javascript
// Test code:
const related = await mj.core.getRecentEntries({ limit: 1 })
const basic = await mj.search.semanticSearch({ query: 'improving performance' })
const byId = await mj.search.semanticSearch({ entry_id: related.entries[0].id })
const strict = await mj.search.semanticSearch({
  query: 'performance',
  similarity_threshold: 0.5,
})
const filtered = await mj.search.semanticSearch({
  query: 'test',
  is_personal: true,
  tags: ['testing'],
})
const noHint = await mj.search.semanticSearch({
  query: 'xyznonexistent',
  hint_on_empty: false,
})
const stats = await mj.search.getVectorIndexStats({})
return {
  basicCount: basic.entries?.length ?? 0,
  byIdCount: byId.entries?.length ?? 0,
  strictCount: strict.entries?.length ?? 0,
  strictFewer: (strict.entries?.length ?? 0) <= (basic.entries?.length ?? 0),
  filteredCorrectly:
    filtered.entries?.every((e) => (e.isPersonal || e.is_personal) && e.tags.includes('testing')) ??
    true,
  noHintHasQualityHint: !!noHint.hint,
  vectorAvailable: stats.available,
  vectorItemCount: stats.itemCount,
}
```

| Check                  | Expected                                |
| ---------------------- | --------------------------------------- |
| `basicCount`           | ≥ 1                                     |
| `byIdCount`            | ≥ 1                                     |
| `strictFewer`          | `true`                                  |
| `noHintHasQualityHint` | `true` (quality gate hint always shown) |
| `vectorAvailable`      | `true`                                  |
| `vectorItemCount`      | Number > 0                              |

### 21.7 Analytics

```javascript
// Test code:
const byMonth = await mj.analytics.getStatistics({ group_by: 'month' })
const byDay = await mj.analytics.getStatistics({ group_by: 'day' })
const withDates = await mj.analytics.getStatistics({
  start_date: '2026-01-01',
  end_date: '2026-03-01',
})
const withProject = await mj.analytics.getStatistics({ project_breakdown: true })
const insights = await mj.analytics.getCrossProjectInsights({})
const insightsFiltered = await mj.analytics.getCrossProjectInsights({
  start_date: '2026-01-01',
  end_date: '2026-03-01',
  min_entries: 1,
})
return {
  hasDecisionDensity: typeof byMonth.decisionDensity !== 'undefined',
  hasRelComplexity: typeof byMonth.relationshipComplexity !== 'undefined',
  hasActivityTrend: typeof byMonth.activityTrend !== 'undefined',
  hasCausalMetrics: typeof byMonth.causalMetrics !== 'undefined',
  dayPeriodsExist: (byDay.entriesByPeriod?.length ?? 0) >= 0,
  dateFilteredRange: !!withDates.dateRange,
  projectBreakdown: !!withProject.projectBreakdown,
  insightsProjectCount: insights.project_count,
  insightsHasProjects: Array.isArray(insights.projects),
  filteredInsights: insightsFiltered.project_count >= 0,
}
```

| Check                 | Expected |
| --------------------- | -------- |
| `hasDecisionDensity`  | `true`   |
| `hasRelComplexity`    | `true`   |
| `hasActivityTrend`    | `true`   |
| `hasCausalMetrics`    | `true`   |
| `dateFilteredRange`   | `true`   |
| `insightsHasProjects` | `true`   |

### 21.8 Vector Index Management

| Test                  | Code                                                                                                                             | Expected Result                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Rebuild index         | `return await mj.admin.rebuildVectorIndex({});`                                                                                  | `{ success: true, entriesIndexed: N }` where N > 0 |
| Add existing to index | `const r = await mj.core.getRecentEntries({ limit: 1 }); return await mj.admin.addToVectorIndex({ entry_id: r.entries[0].id });` | `{ success: true, entryId: N }`                    |
| Add nonexistent       | `return await mj.admin.addToVectorIndex({ entry_id: 999999 });`                                                                  | `{ success: false, error: "..." }`                 |

---

## Success Criteria

- [ ] `search_entries` respects `mode: 'fts'` and `mode: 'semantic'` explicitly via Code Mode
- [ ] `search_entries` auto-mode correctly evaluates conversational RRF heuristic via Code Mode
- [ ] FTS5 phrase, prefix, boolean NOT, boolean OR all return correct results via Code Mode
- [ ] FTS5 LIKE fallback works for special characters (`test's`, `100%`)
- [ ] `search_entries` filters work: `issue_number`, `pr_status`, `workflow_run_id`, `project_number`, `is_personal`, `tags`, `entry_type`, `start_date`, `end_date`
- [ ] Cross-DB search returns entries with `source: 'personal'` and `source: 'team'`
- [ ] `search_by_date_range` with filters (`entry_type`, `tags`, `is_personal`) works
- [ ] `search_by_date_range` rejects invalid date format with structured error
- [ ] `semantic_search` processes Related by ID (`entry_id`) lookups avoiding query strings
- [ ] `semantic_search` correctly filters results downstream using `tags` and `is_personal`
- [ ] `semantic_search` with custom threshold returns fewer results
- [ ] `semantic_search` quality gate hint shown even with `hint_on_empty: false`
- [ ] `get_vector_index_stats` returns `available`, `itemCount`, `modelName`, `dimensions`
- [ ] `rebuild_vector_index` and `add_to_vector_index` work via Code Mode
- [ ] `get_statistics` returns all 4 enhanced analytics metrics via Code Mode
- [ ] `get_cross_project_insights` returns schema-compliant response
