# Re-Test memory-journal-mcp — Code Mode: Search & Semantics

Test search, semantic search, date range, analytics, and vector index operations through the Code Mode `mj.*` API bridge.

**Scope:** 1 tool (`mj_execute_code`), Phase 21 (Part 2) — ~20 test cases covering FTS5, filters, semantic search, and analytics via Code Mode.

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

## Phase 21: Search & Semantics via Code Mode

> [!NOTE]
> To ensure deterministic test results, execute the following setup snippet to guarantee cases for FTS5 fallback and search filters:
>
> ```javascript
> await mj.core.createEntry({
>   workspace_id: "test-ws",
>   content: "This is a test's string with 100% coverage",
>   issueNumber: 44,
>   prStatus: 'merged',
>   workflowRunId: 12345,
>   workspace_id: "test-ws",
>   isPersonal: true,
> })
> ```

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
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
})
const withType = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
  type: 'planning',
})
const withTags = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
  tags: ['deploy'],
})
const withPersonal = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
  isPersonal: true,
})
const withProject = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
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
| `projectCount`    | ≥ 0 (entries linked to workspace test-ws)     |

### 21.5 Search by Date Range & Input — Error Paths

| Test                | Code                                                                                                                 | Expected Result                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Invalid date format | `return await mj.search.searchByDateRange({ workspace_id: "test-ws", fromDate: "Jan 1", toDate: "Jan 31" });`          | `{ success: false, error: "..." }` with YYYY-MM-DD hint     |
| Inverted date range | `return await mj.search.searchByDateRange({ workspace_id: "test-ws", fromDate: "2026-12-31", toDate: "2026-01-01" });` | `{ success: false, error: "..." }` start must be before end |
| Query too long      | `return await mj.search.searchEntries({ workspace_id: "test-ws", query: "a".repeat(300) });`                               | `{ success: false, error: "..." }` with Zod validation hint |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- search_entries respects mode: 'fts' and mode: 'semantic' explicitly via Code Mode
- search_entries auto-mode correctly evaluates conversational RRF heuristic via Code Mode
- FTS correctly parses standard keyword/phrase syntax (OR, NOT, "phrases")
- FTS detects unsafe queries (like 	test's) and seamlessly drops to LIKE fallback without crashing
- Hybrid search utilizes RRF mode automatically when heuristics warrant it
- exact_match: true successfully maps to fuzzyMatch: false resulting in exact matching
- exact_match: false successfully maps to fuzzyMatch: true resulting in Levenshtein matching
- FTS5 phrase, prefix, boolean NOT, boolean OR all return correct results via Code Mode
- FTS5 LIKE fallback works for special characters (	test's, 100%)
- search_entries gracefully falls back to fuzzy Levenshtein matching via Code Mode when fuzzyMatch is true and FTS yields zero results
- search_entries filters work: issueNumber, prStatus, workflowRunId, workspace_id, isPersonal, 	tags, type, fromDate, toDate
- Cross-DB search returns entries with source: 'personal' and source: 'team'
- search_by_date_range with filters (type, 	tags, isPersonal) works
- search_by_date_range rejects invalid date format with structured error
- search_by_date_range rejects inverted date range (start > end) with structured error
- search_entries rejects queries exceeding 250 characters with structured Zod error
- search_by_date_range filters by workspace_id
- semantic_search processes Related by ID (id) lookups avoiding query strings
- semantic_search correctly filters results downstream using 	tags and isPersonal
- semantic_search with custom threshold returns fewer results
- semantic_search quality gate hint shown even with hint_on_empty: false
- get_vector_index_stats returns available, itemCount, modelName, dimensions
- rebuild_vector_index and add_to_vector_index work via Code Mode
- get_statistics returns all 4 enhanced analytics metrics via Code Mode
- get_cross_project_insights returns schema-compliant response
> **Note**: When updating schemas or validation logic, please refer to the /zod skill for best practices on Standard Schema and Safe Parsing.
