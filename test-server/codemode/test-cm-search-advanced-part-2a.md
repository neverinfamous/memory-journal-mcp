# Re-Test memory-journal-mcp — Code Mode: Search & Semantics Advanced

Test semantic search, analytics, and vector index operations through the Code Mode mj.* API bridge.

**Scope:** 1 tool (mj_execute_code), Phase 21B — advanced features.

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
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 21B: Semantics & Analytics via Code Mode

### 21.9 Importance-Sorted Search

> [!NOTE]
> These tests validate the `sortBy: 'importance'` parameter across `search_entries`, `get_recent_entries`, and `search_by_date_range`. Setup: create entries with varying importance signals.

```javascript
// Setup: create test entries with different importance profiles
const e1 = await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'IMPSORT_TEST_LOW: no significance, no relationships',
  type: 'test_entry',
  tags: ['importance-sort-test'],
})
const e2 = await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'IMPSORT_TEST_HIGH: milestone with relationships',
  type: 'test_entry',
  tags: ['importance-sort-test'],
  significance_type: 'milestone',
})
const e3 = await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'IMPSORT_TEST_MED: decision with causal link',
  type: 'test_entry',
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

// T1: search_entries with sortBy: 'importance'
const impSearch = await mj.search.searchEntries({
  workspace_id: "test-ws",
  query: 'IMPSORT_TEST',
  sortBy: 'importance',
  mode: 'fts',
  limit: 10,
})

// T2: search_entries with default sortBy (timestamp)
const tsSearch = await mj.search.searchEntries({
  workspace_id: "test-ws",
  query: 'IMPSORT_TEST',
  limit: 10,
})

// T3: get_recent_entries with sortBy: 'importance'
const impRecent = await mj.core.getRecentEntries({
  workspace_id: "test-ws",
  limit: 5,
  sortBy: 'importance',
})

// T4: get_recent_entries with default sortBy (timestamp)
const tsRecent = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 5 })

// T5: search_by_date_range with sortBy: 'importance'
const today = new Date().toISOString().split('T')[0]
const impDateRange = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-01-01',
  toDate: today,
  sortBy: 'importance',
  limit: 5,
})

// T6: search_by_date_range with default sortBy (timestamp)
const tsDateRange = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-01-01',
  toDate: today,
  limit: 5,
})

// Cleanup
await mj.admin.deleteEntry({ id: e1.entry.id, permanent: true })
await mj.admin.deleteEntry({ id: e2.entry.id, permanent: true })
await mj.admin.deleteEntry({ id: e3.entry.id, permanent: true })

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

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.







ext_cursor) works reliably across FTS, semantic, and date range searches via Code Mode scripts
- See part 2 for remaining success criteria.
