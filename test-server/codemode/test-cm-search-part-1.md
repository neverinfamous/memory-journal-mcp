# Re-Test memory-journal-mcp — Code Mode: Search & Semantics

Test search, semantic search, date range, analytics, and vector index operations through the Code Mode `mj.*` API bridge.

**Scope:** 1 tool (`mj_execute_code`), Phase 21 — ~20 test cases covering FTS5, filters, semantic search, and analytics via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
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

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- See part 2 for remaining success criteria.
