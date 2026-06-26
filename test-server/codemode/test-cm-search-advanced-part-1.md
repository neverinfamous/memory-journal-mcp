# Re-Test memory-journal-mcp — Code Mode: Search & Semantics Advanced

Test semantic search, analytics, and vector index operations through the Code Mode mj.* API bridge.

**Scope:** 1 tool (mj_execute_code), Phase 21B — advanced features.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found.
2. Use code-map.md as a source of truth.
3. If you made code changes/fixes, update UNRELEASED.md and commit.
4. Re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

---

## Phase 21B: Semantics & Analytics via Code Mode

### 21.6 Semantic Search

```javascript
// Test code:
const related = await mj.core.getRecentEntries({ project_number: 5, limit: 1 })
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
  similarity_threshold: 0.0,
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
  hasModelName: typeof stats.modelName === 'string',
  hasDimensions: typeof stats.dimensions === 'number',
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
| `hasModelName`         | `true`                                  |
| `hasDimensions`        | `true`                                  |

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

| Test                  | Code                                                                                                                                                | Expected Result                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Rebuild index         | `await mj.admin.batchCreateEntries({ entries: [{ content: "test", project_number: 5 }], auto_index: false }); return await mj.admin.rebuildVectorIndex({});` | `{ success: true, entriesIndexed: N }` where N > 0 |
| Add existing to index | `const r = await mj.core.getRecentEntries({ project_number: 5, limit: 1 }); return await mj.admin.addToVectorIndex({ entry_id: r.entries[0].id });` | `{ success: true, entryId: N }`                    |
| Add nonexistent       | `return await mj.admin.addToVectorIndex({ entry_id: 999999 });`                                                                                     | `{ success: false, error: "..." }`                 |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `search_entries` respects `mode: 'fts'` and `mode: 'semantic'` explicitly via Code Mode
- `search_entries` auto-mode correctly evaluates conversational RRF heuristic via Code Mode
- FTS correctly parses standard keyword/phrase syntax (OR, NOT, "phrases")
- FTS detects unsafe queries (like `test's`) and seamlessly drops to `LIKE` fallback without crashing
- Hybrid search utilizes RRF mode automatically when heuristics warrant it
- `exact_match: true` successfully maps to `fuzzy_match: false` resulting in exact matching
- `exact_match: false` successfully maps to `fuzzy_match: true` resulting in Levenshtein matching
- FTS5 phrase, prefix, boolean NOT, boolean OR all return correct results via Code Mode
- FTS5 LIKE fallback works for special characters (`test's`, `100%`)
- `search_entries` gracefully falls back to fuzzy Levenshtein matching via Code Mode when `fuzzy_match` is true and FTS yields zero results
- `search_entries` filters work: `issue_number`, `pr_status`, `workflow_run_id`, `project_number`, `is_personal`, `tags`, `entry_type`, `start_date`, `end_date`
- Cross-DB search returns entries with `source: 'personal'` and `source: 'team'`
- `search_by_date_range` with filters (`entry_type`, `tags`, `is_personal`) works
- `search_by_date_range` rejects invalid date format with structured error
- `search_by_date_range` rejects inverted date range (start > end) with structured error
- `search_entries` rejects queries exceeding 250 characters with structured Zod error
- `search_by_date_range` filters by `project_number`
- `semantic_search` processes Related by ID (`entry_id`) lookups avoiding query strings
- `semantic_search` correctly filters results downstream using `tags` and `is_personal`
- `semantic_search` with custom threshold returns fewer results
- `semantic_search` quality gate hint shown even with `hint_on_empty: false`
- `get_vector_index_stats` returns `available`, `itemCount`, `modelName`, `dimensions`
- `rebuild_vector_index` and `add_to_vector_index` work via Code Mode
- `get_statistics` returns all 4 enhanced analytics metrics via Code Mode
- `get_cross_project_insights` returns schema-compliant response
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- `search_entries` with `sort_by: 'importance'` returns entries sorted by importance with `importanceScore` field
- `get_recent_entries` with `sort_by: 'importance'` returns entries sorted by importance with `importanceScore` field
- `search_by_date_range` with `sort_by: 'importance'` returns entries sorted by importance with `importanceScore` field
- Default `sort_by` (timestamp) produces zero overhead — no `importanceScore` field present
- `search_entries` and `search_by_date_range` correctly respect the `include_archived` filter via Code Mode scripts
- Keyset cursor pagination (`cursor` & `next_cursor`) works reliably across FTS, semantic, and date range searches via Code Mode scripts
- `search_entries` with `include_highlights: true` returns snippets with FTS query terms highlighted via Code Mode
- `search_entries` with `include_facets: true` returns aggregate tag and entryType distribution counts via Code Mode
- Hybrid mode properly supports `fts_weight` and `semantic_weight` dynamic biasing multipliers via Code Mode
- FTS query parser safely preserves balanced double-quotes for true phrase matching without crashing the sandbox
