# Re-Test memory-journal-mcp — Code Mode: Search & Semantics

Test search, semantic search, date range, analytics, and vector index operations through the Code Mode `mj.*` API bridge.

**Scope:** 1 tool (`mj_execute_code`), Phase 21 — ~20 test cases covering FTS5, filters, semantic search, and analytics via Code Mode.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 21: Search & Semantics via Code Mode

> [!NOTE]
> To ensure deterministic test results, execute the following setup snippet to guarantee cases for FTS5 fallback and search filters:
>
> ```javascript
> await mj.core.createEntry({
> workspace_id: "test-ws", >   content: "This is a test's string with 100% coverage",
>   issue_number: 44,
>   pr_status: 'merged',
>   workflow_run_id: 12345,
>   workspace_id: "test-ws",
>   is_personal: true,
> })
> ```

### 21.1 FTS5 Search Patterns

| Test            | Code                                                                                                             | Expected Result                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Basic query     | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "architecture" });`                            | ≥ 2 results (S1, S11)           |
| Phrase          | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: '"error handling"' });`                        | ≥ 1 result (S2)                 |
| Prefix          | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "auth*" });`                                   | ≥ 2 results (S1, S8)            |
| FTS5 NOT        | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "deploy NOT staging", mode: "fts" });`         | Returns S3 but NOT S5           |
| FTS5 OR         | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "deploy OR release", mode: "fts" });`          | ≥ 2 results (S3, S4, S5)        |
| LIKE fallback   | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "test's", mode: "fts" });`                     | ≥ 1 result (S6)                 |
| Special chars   | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "100%", mode: "fts" });`                       | ≥ 1 result (S6)                 |
| Fuzzy fallback  | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "architeqture", mode: "fts", fuzzy_match: true });` | ≥ 1 result (S1/S11)             |
| Fuzzy off       | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "architeqture", mode: "fts", fuzzy_match: false });`| 0 results                       |
| Hybrid auto     | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "performance architecture fix" });`              | Heuristic RRF triggering S7     |
| Forced semantic | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "improving performance", mode: "semantic" });` | Vector similarity bypassing FTS |

### 21.2 Search Filters

```javascript
// Test code:
const byIssue = await mj.search.searchEntries({ workspace_id: "test-ws", issue_number: 44 })
const byPr = await mj.search.searchEntries({ workspace_id: "test-ws", pr_status: 'merged' })
const byWorkflow = await mj.search.searchEntries({ workspace_id: "test-ws", workflow_run_id: 12345 })
const byProject = await mj.search.searchEntries({ workspace_id: "test-ws" })
const personal = await mj.search.searchEntries({
  workspace_id: "test-ws",
  query: 'test',
  is_personal: true,
})
const tagged = await mj.search.searchEntries({ workspace_id: "test-ws", tags: ['testing'] })
const typed = await mj.search.searchEntries({ workspace_id: "test-ws", entry_type: 'planning' })
const dated = await mj.search.searchEntries({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: '2026-12-31',
})
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
const results = await mj.search.searchEntries({
  workspace_id: "test-ws",
  query: 'architecture',
  limit: 20,
})
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
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: '2026-12-31',
})
const withType = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  entry_type: 'planning',
})
const withTags = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  tags: ['deploy'],
})
const withPersonal = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  is_personal: true,
})
const withProject = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  workspace_id: "test-ws",
})
return {
  basicCount: basic.entries.length,
  typeCount: withType.entries.length,
  typeAllPlanning: withType.entries.every((e) => e.entryType === 'planning'),
  tagCount: withTags.entries.length,
  personalCount: withPersonal.entries.length,
  projectCount: withProject.entries.length,
}
```

| Check             | Expected                               |
| ----------------- | -------------------------------------- |
| `basicCount`      | ≥ 1                                    |
| `typeAllPlanning` | `true` (if any planning entries exist) |
| `tagCount`        | ≥ 1 (entries with "deploy" tag)        |
| `personalCount`   | ≥ 0                                    |
| `projectCount`    | ≥ 0 (entries linked to project #5)     |

### 21.5 Search by Date Range & Input — Error Paths

| Test                | Code                                                                                                                 | Expected Result                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Invalid date format | `return await mj.search.searchByDateRange({ workspace_id: "test-ws", start_date: "Jan 1", end_date: "Jan 31" });`          | `{ success: false, error: "..." }` with YYYY-MM-DD hint     |
| Inverted date range | `return await mj.search.searchByDateRange({ workspace_id: "test-ws", start_date: "2026-12-31", end_date: "2026-01-01" });` | `{ success: false, error: "..." }` start must be before end |
| Query too long      | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "a".repeat(300) });`                               | `{ success: false, error: "..." }` with Zod validation hint |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- search_entries respects mode: 'fts' and mode: 'semantic' explicitly via Code Mode
- search_entries auto-mode correctly evaluates conversational RRF heuristic via Code Mode
- FTS correctly parses standard keyword/phrase syntax (OR, NOT, "phrases")
- FTS detects unsafe queries (like 	test's) and seamlessly drops to LIKE fallback without crashing
- Hybrid search utilizes RRF mode automatically when heuristics warrant it
- exact_match: true successfully maps to fuzzy_match: false resulting in exact matching
- exact_match: false successfully maps to fuzzy_match: true resulting in Levenshtein matching
- FTS5 phrase, prefix, boolean NOT, boolean OR all return correct results via Code Mode
- FTS5 LIKE fallback works for special characters (	test's, 100%)
- search_entries gracefully falls back to fuzzy Levenshtein matching via Code Mode when fuzzy_match is true and FTS yields zero results
- search_entries filters work: issue_number, pr_status, workflow_run_id, project_number, is_personal, 	tags, entry_type, start_date, end_date
- Cross-DB search returns entries with source: 'personal' and source: 'team'
- search_by_date_range with filters (entry_type, 	tags, is_personal) works
- search_by_date_range rejects invalid date format with structured error
- search_by_date_range rejects inverted date range (start > end) with structured error
- search_entries rejects queries exceeding 250 characters with structured Zod error
- search_by_date_range filters by project_number
- semantic_search processes Related by ID (entry_id) lookups avoiding query strings
- semantic_search correctly filters results downstream using 	tags and is_personal
- semantic_search with custom threshold returns fewer results
- semantic_search quality gate hint shown even with hint_on_empty: false
- get_vector_index_stats returns available, itemCount, modelName, dimensions
- rebuild_vector_index and add_to_vector_index work via Code Mode
- get_statistics returns all 4 enhanced analytics metrics via Code Mode
- get_cross_project_insights returns schema-compliant response
> **Note**: When updating schemas or validation logic, please refer to the /zod skill for best practices on Standard Schema and Safe Parsing.
