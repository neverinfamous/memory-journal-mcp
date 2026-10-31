# Re-Test memory-journal-mcp — Code Mode: Search & Semantics Advanced

Test semantic search, analytics, and vector index operations through the Code Mode mj.* API bridge.

**Scope:** 1 tool (mj_execute_code), Phase 21B (Part 2) — advanced features.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 21B: Semantics & Analytics via Code Mode

### 21.10 Keyset Pagination & Archiving in Search

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws", content: 'CM3 search archiving pagination test' })
const id = created.entry.id
await mj.admin.updateEntry({ id: id, isArchived: true })

const searchArchivedOff = await mj.search.searchEntries({ workspace_id: "test-ws", query: "search archiving pagination", includeArchived: false })
const isArchivedHidden = !searchArchivedOff.entries?.some(e => e.id === id)

const searchArchivedOn = await mj.search.searchEntries({ workspace_id: "test-ws", query: "search archiving pagination", includeArchived: true })
const isArchivedVisible = searchArchivedOn.entries?.some(e => e.id === id)

const searchPagPage1 = await mj.search.searchEntries({ workspace_id: "test-ws", query: "test", limit: 2 })
const hasSearchCursor = typeof searchPagPage1.nextCursor === 'string'

// Clean up
await mj.admin.deleteEntry({ id: id, permanent: true })

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
const withWeights = await mj.search.searchEntries({ workspace_id: "test-ws", query: "performance", mode: "hybrid", ftsWeight: 2.0, semanticWeight: 0.1 })
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

- search_entries with sortBy: 'importance' returns entries sorted by importance with importanceScore field
- get_recent_entries with sortBy: 'importance' returns entries sorted by importance with importanceScore field
- search_by_date_range with sortBy: 'importance' returns entries sorted by importance with importanceScore field
- Default sortBy (timestamp) produces zero overhead — no importanceScore field present
- search_entries and search_by_date_range correctly respect the includeArchived filter via Code Mode scripts
- Keyset cursor pagination (cursor & 
ext_cursor) works reliably across FTS, semantic, and date range searches via Code Mode scripts
- search_entries with include_highlights: true returns snippets with FTS query terms highlighted via Code Mode
- search_entries with include_facets: true returns aggregate tag and entryType distribution counts via Code Mode
- Hybrid mode properly supports ts_weight and semanticWeight dynamic biasing multipliers via Code Mode
- FTS query parser safely preserves balanced double-quotes for true phrase matching without crashing the sandbox
