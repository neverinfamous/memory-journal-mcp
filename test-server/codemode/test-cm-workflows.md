# Re-Test memory-journal-mcp — Code Mode: Multi-Step Workflows

Test multi-step workflow execution: read-only pipelines, conditional branching, and create+read round-trips through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 22 — ~5 test cases covering chained API calls and data transformation.

**Prerequisites:**

- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.
- Use codemode directly for all tests — not the terminal or scripts.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

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

## Success Criteria

- [ ] Chaining 2+ API calls in single execution works
- [ ] Data transformation (map, flatMap, sort, reduce) works on results
- [ ] Conditional branching based on query results works
- [ ] Create + read round-trip produces matching data
- [ ] Create + search finds the created entry
