# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps

Systematic verification of structured error handling across all `mj.*` API groups via the Code Mode sandbox. Validates that `{}` empty params, type mismatches, and domain errors all return structured `{success: false}` responses — never raw MCP exceptions.

**Scope:** 1 tool (`mj_execute_code`), Phase 29 — consolidated Zod sweep and type mismatch tests across all 10 API groups.

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

## Phase 29: Error Matrix via Code Mode

> [!TIP]
> Each test block calls multiple tools with intentionally bad inputs in a single Code Mode execution — validating that every structured error returns `{success: false}` and never crashes the sandbox. Map results to compact summaries to keep token estimates low.

### 29.1 Core Group — Empty Params & Type Mismatches

```javascript
// Test code:
const createEmpty = await mj.core.createEntry({ workspace_id: "test-ws" })
const createMinEmpty = await mj.core.createEntry({ workspace_id: "test-ws", })
const getByIdEmpty = await mj.core.getEntryById({})
const recentEmpty = await mj.core.getRecentEntries({ workspace_id: "test-ws" })
const statsEmpty = await mj.analytics.getStatistics({})
const tagsEmpty = await mj.core.listTags({})
const getHistoryEmpty = await mj.core.getEntryHistory({})

// Type mismatches
const contentNum = await mj.core.createEntry({ workspace_id: "test-ws", content: 123 })
const limitStr = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 'abc' })
const idStr = await mj.core.getEntryById({ id: 'abc' })
const limitNeg = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: -1 })
const historyIdStr = await mj.core.getEntryHistory({ id: 'abc' })

return {
  createEmpty: createEmpty.success === false,
  createMinEmpty: createMinEmpty.success === false,
  getByIdEmpty: getByIdEmpty.success === false,
  recentDefaults: recentEmpty.entries?.length >= 0,
  statsDefaults: typeof statsEmpty.totalEntries === 'number',
  tagsDefaults: Array.isArray(tagsEmpty.tags),
  contentNumError: contentNum.success === false,
  limitStrHandled: limitStr.success === false || Array.isArray(limitStr.entries),
  idStrError: idStr.success === false,
  limitNegError: limitNeg.success === false,
  getHistoryEmptyError: getHistoryEmpty.success === false,
  historyIdStrError: historyIdStr.success === false,
}
```

| Check             | Expected                                   |
| ----------------- | ------------------------------------------ |
| `createEmpty`     | `true` (content required)                  |
| `createMinEmpty`  | `true` (content required)                  |
| `getByIdEmpty`    | `true` (id required)                 |
| `recentDefaults`  | `true` (uses defaults)                     |
| `statsDefaults`   | `true` (uses defaults)                     |
| `tagsDefaults`    | `true` (no params needed)                  |
| `contentNumError` | `true` (content must be string)            |
| `limitStrHandled` | `true` (coerces or errors — never crashes) |
| `idStrError`      | `true` (id must be number)           |
| `limitNegError`   | `true` (limit must be ≥ 1)                 |
| `getHistoryEmptyError` | `true` (id required)            |
| `historyIdStrError` | `true` (id must be number)         |

### 29.2 Search Group — Empty Params & Boundaries

```javascript
// Test code:
const searchEmpty = await mj.search.searchEntries({ workspace_id: "test-ws" })
const dateRangeEmpty = await mj.search.searchByDateRange({ workspace_id: "test-ws" })
const semanticEmpty = await mj.search.semanticSearch({})
const vectorStatsEmpty = await mj.search.getVectorIndexStats({})

// Boundary tests
const limitOver = await mj.search.searchEntries({ workspace_id: "test-ws", query: 'test', limit: 501 })
const thresholdStr = await mj.search.semanticSearch({ query: 'test', similarityThreshold: 'abc' })
const dateInvalid = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  fromDate: 'Jan 1',
  toDate: 'Jan 31',
})
const dateInverted = await mj.search.searchByDateRange({
  workspace_id: "test-ws",
  fromDate: '2026-12-31',
  toDate: '2026-01-01',
})
const searchTypeMismatch = await mj.search.searchEntries({ workspace_id: "test-ws", query: 'test', ftsWeight: 'abc', include_highlights: 'abc' })

return {
  searchEmptyHandled: searchEmpty.success === false || Array.isArray(searchEmpty.entries),
  dateRangeEmptyError: dateRangeEmpty.success === false,
  semanticEmptyError: semanticEmpty.success === false,
  vectorStatsOk: typeof vectorStatsEmpty.available === 'boolean',
  limitOverError: limitOver.success === false,
  thresholdStrError: thresholdStr.success === false,
  dateInvalidError: dateInvalid.success === false,
  dateInvertedError: dateInverted.success === false,
  searchTypeMismatchError: searchTypeMismatch.success === false,
}
```

| Check                 | Expected                            |
| --------------------- | ----------------------------------- |
| `dateRangeEmptyError` | `true` (start/end date required)    |
| `semanticEmptyError`  | `true` (query or id required) |
| `vectorStatsOk`       | `true` (no params needed)           |
| `limitOverError`      | `true` (limit max 500)              |
| `dateInvalidError`    | `true` (YYYY-MM-DD required)        |
| `dateInvertedError`   | `true` (start must be before end)   |
| `searchTypeMismatchError` | `true` (type mismatches caught) |



## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Core and Search API groups tested with `{}` empty params
- Type mismatches return structured errors
- Domain errors return `{success: false}`
- Security boundaries enforced
- No sandbox crashes
