# Re-Test memory-journal-mcp — Code Mode: Search & Semantics Advanced

Test semantic search, analytics, and vector index operations through the Code Mode mj.* API bridge.

**Scope:** 1 tool (mj_execute_code), Phase 21B (Part 2) — advanced features.

**Prerequisites:**

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
