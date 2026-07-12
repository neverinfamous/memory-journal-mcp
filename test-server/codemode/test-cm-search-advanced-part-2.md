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

### 21.9 Importance-Sorted Search

> [!NOTE]
> These tests validate the `sort_by: 'importance'` parameter across `search_entries`, `get_recent_entries`, and `search_by_date_range`. Setup: create entries with varying importance signals.

```javascript
// Setup: create test entries with different importance profiles
const e1 = await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'IMPSORT_TEST_LOW: no significance, no relationships',
  entry_type: 'test_entry',
  tags: ['importance-sort-test'],
})
const e2 = await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'IMPSORT_TEST_HIGH: milestone with relationships',
  entry_type: 'test_entry',
  tags: ['importance-sort-test'],
  significance_type: 'milestone',
})
const e3 = await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'IMPSORT_TEST_MED: decision with causal link',
  entry_type: 'test_entry',
  tags: ['importance-sort-test'],
  significance_type: 'decision',
})
// Add relationships to boost e2 and e3
await mj.relationships.linkEntries({
  from_entry_id: e2.entry.id,
  to_entry_id: e1.entry.id,
  relationship_type: 'references',
})
await mj.relationships.linkEntries({
  from_entry_id: e2.entry.id,
  to_entry_id: e3.entry.id,
  relationship_type: 'caused',
})
await mj.relationships.linkEntries({
  from_entry_id: e3.entry.id,
  to_entry_id: e1.entry.id,
  relationship_type: 'resolved',
})

// T1: search_entries with sort_by: 'importance'
const impSearch = await mj.search.searchEntries({
  workspace_id: "test-ws",
  query: 'IMPSORT_TEST',
  sort_by: 'importance',
  mode: 'fts',
  limit: 10,
})

// T2: search_entries with default sort_by (timestamp)
const tsSearch = await mj.search.searchEntries({
  workspace_id: "test-ws",
  query: 'IMPSORT_TEST',
  limit: 10,
})

// T3: get_recent_entries with sort_by: 'importance'
const impRecent = await mj.core.getRecentEntries({
  workspace_id: "test-ws",
  limit: 5,
  sort_by: 'importance',
})

// T4: get_recent_entries with default sort_by (timestamp)
const tsRecent = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 5 })

// T5: search_by_date_range with sort_by: 'importance'
const today = new Date().toISOString().split('T')[0]
const impDateRange = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: today,
  sort_by: 'importance',
  limit: 5,
})

// T6: search_by_date_range with default sort_by (timestamp)
const tsDateRange = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: today,
  limit: 5,
})

// Cleanup
await mj.admin.deleteEntry({ entry_id: e1.entry.id, permanent: true })
await mj.admin.deleteEntry({ entry_id: e2.entry.id, permanent: true })
await mj.admin.deleteEntry({ entry_id: e3.entry.id, permanent: true })

return {
  searchImportance: {
    count: impSearch.count,
    hasScores: impSearch.entries?.every((e) => typeof e.importanceScore === 'number'),
    orderCorrect: impSearch.entries?.every(
      (e, i, arr) => i === 0 || (arr[i - 1].importanceScore ?? 0) >= (e.importanceScore ?? 0)
    ),
  },
  searchTimestamp: {
    noScores: tsSearch.entries?.every((e) => e.importanceScore === undefined),
  },
  recentImportance: {
    hasScores: impRecent.entries?.every((e) => typeof e.importanceScore === 'number'),
    orderCorrect: impRecent.entries?.every(
      (e, i, arr) => i === 0 || (arr[i - 1].importanceScore ?? 0) >= (e.importanceScore ?? 0)
    ),
  },
  recentTimestamp: {
    noScores: tsRecent.entries?.every((e) => e.importanceScore === undefined),
  },
  dateRangeImportance: {
    hasScores: impDateRange.entries?.every((e) => typeof e.importanceScore === 'number'),
    orderCorrect: impDateRange.entries?.every(
      (e, i, arr) => i === 0 || (arr[i - 1].importanceScore ?? 0) >= (e.importanceScore ?? 0)
    ),
  },
  dateRangeTimestamp: {
    noScores: tsDateRange.entries?.every((e) => e.importanceScore === undefined),
  },
}
```

| Check                              | Expected                                      |
| ---------------------------------- | --------------------------------------------- |
| `searchImportance.hasScores`       | `true` — every entry has `importanceScore`    |
| `searchImportance.orderCorrect`    | `true` — descending importance order          |
| `searchTimestamp.noScores`         | `true` — no `importanceScore` (zero overhead) |
| `recentImportance.hasScores`       | `true` — every entry has `importanceScore`    |
| `recentImportance.orderCorrect`    | `true` — descending importance order          |
| `recentTimestamp.noScores`         | `true` — no `importanceScore` (zero overhead) |
| `dateRangeImportance.hasScores`    | `true` — every entry has `importanceScore`    |
| `dateRangeImportance.orderCorrect` | `true` — descending importance order          |
| `dateRangeTimestamp.noScores`      | `true` — no `importanceScore` (zero overhead) |

---

### 21.10 Keyset Pagination & Archiving in Search

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws", content: 'CM3 search archiving pagination test' })
const id = created.entry.id
await mj.admin.updateEntry({ entry_id: id, is_archived: true })

const searchArchivedOff = await mj.search.searchEntries({ workspace_id: "test-ws", query: "search archiving pagination", include_archived: false })
const isArchivedHidden = !searchArchivedOff.entries?.some(e => e.id === id)

const searchArchivedOn = await mj.search.searchEntries({ workspace_id: "test-ws", query: "search archiving pagination", include_archived: true })
const isArchivedVisible = searchArchivedOn.entries?.some(e => e.id === id)

const searchPagPage1 = await mj.search.searchEntries({ workspace_id: "test-ws", query: "test", limit: 2 })
const hasSearchCursor = typeof searchPagPage1.next_cursor === 'string'

// Clean up
await mj.admin.deleteEntry({ entry_id: id, permanent: true })

return {
  isArchivedHidden,
  isArchivedVisible,
  hasSearchCursor,
}
```

| Check               | Expected |
| ------------------- | -------- |
| `isArchivedHidden`  | `true`   |
| `isArchivedVisible` | `true`   |
| `hasSearchCursor`   | `true`   |

---

### 21.11 Search Enhancements (Highlights, Facets, Weights, Quotes)

```javascript
// Test code:
const withHighlights = await mj.search.searchEntries({ workspace_id: "test-ws", query: "architecture", include_highlights: true, mode: "fts" })
const withFacets = await mj.search.searchEntries({ workspace_id: "test-ws", query: "test", include_facets: true })
const withWeights = await mj.search.searchEntries({ workspace_id: "test-ws", query: "performance", mode: "hybrid", fts_weight: 2.0, semantic_weight: 0.1 })
const withQuotes = await mj.search.searchEntries({ workspace_id: "test-ws", query: '"error handling" AND "performance"', mode: "fts" })

return {
  hasHighlights: Array.isArray(withHighlights.highlights) && withHighlights.highlights.length >= 0,
  hasTagsFacet: typeof withFacets.facets === 'object' && Array.isArray(withFacets.facets.tags),
  hasTypesFacet: typeof withFacets.facets === 'object' && Array.isArray(withFacets.facets.entryTypes),
  weightsExecutes: typeof withWeights.count === 'number',
  quotesExecutes: typeof withQuotes.count === 'number',
}
```

| Check               | Expected |
| ------------------- | -------- |
| `hasHighlights`     | `true`   |
| `hasTagsFacet`      | `true`   |
| `hasTypesFacet`     | `true`   |
| `weightsExecutes`   | `true`   |
| `quotesExecutes`    | `true`   |

---


## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- search_entries with sort_by: 'importance' returns entries sorted by importance with importanceScore field
- get_recent_entries with sort_by: 'importance' returns entries sorted by importance with importanceScore field
- search_by_date_range with sort_by: 'importance' returns entries sorted by importance with importanceScore field
- Default sort_by (timestamp) produces zero overhead — no importanceScore field present
- search_entries and search_by_date_range correctly respect the include_archived filter via Code Mode scripts
- Keyset cursor pagination (cursor & 
ext_cursor) works reliably across FTS, semantic, and date range searches via Code Mode scripts
- search_entries with include_highlights: true returns snippets with FTS query terms highlighted via Code Mode
- search_entries with include_facets: true returns aggregate tag and entryType distribution counts via Code Mode
- Hybrid mode properly supports ts_weight and semantic_weight dynamic biasing multipliers via Code Mode
- FTS query parser safely preserves balanced double-quotes for true phrase matching without crashing the sandbox
