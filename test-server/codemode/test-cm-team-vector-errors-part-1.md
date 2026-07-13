# Re-Test memory-journal-mcp — Code Mode: Team Vector, Insights & Cross-Tool Errors

Test team vector search, cross-project insights, and comprehensive cross-tool error path verification through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.10–28.11 — ~10 test cases covering team vector operations, insights, and cross-tool structured error verification via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Seed data S15–S17 are team DB entries with `workspace_id: "test-ws"`, required for `team_get_cross_project_insights`.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 28 (continued): Team Vector, Insights & Cross-Tool Errors

### 28.9 Team Vector & Cross-Project Insights

```javascript
// Test code:
const rebuild = await mj.team.teamRebuildVectorIndex({})
const stats = await mj.team.teamGetVectorIndexStats({})

const recent = await mj.team.teamGetRecent({ workspace_id: "test-ws", limit: 1 })
let addResult = { success: false }
if (recent.success && recent.entries && recent.entries.length > 0) {
  addResult = await mj.team.teamAddToVectorIndex({
    workspace_id: "test-ws",
    entry_id: recent.entries[0].id,
  })
}

const addBad = await mj.team.teamAddToVectorIndex({
  workspace_id: "test-ws",
  entry_id: 999999,
})

const search = await mj.team.teamSemanticSearch({
  workspace_id: "test-ws",
  query: 'standup',
})
let relatedById = { entries: [] }
if (recent.success && recent.entries && recent.entries.length > 0) {
  relatedById = await mj.team.teamSemanticSearch({
    workspace_id: "test-ws",
    entry_id: recent.entries[0].id,
  })
}
const strict = await mj.team.teamSemanticSearch({
  workspace_id: "test-ws",
  query: 'standup',
  similarity_threshold: 0.5,
})

const insights = await mj.team.teamGetCrossProjectInsights({})
const insightsFiltered = await mj.team.teamGetCrossProjectInsights({
  start_date: '2026-01-01',
  end_date: '2026-03-01',
  min_entries: 1,
})

return {
  rebuildSuccess: rebuild.success,
  entriesIndexed: rebuild.success ? rebuild.entriesIndexed : 0,
  vectorAvailable: stats.success ? stats.available : false,
  vectorItemCount: stats.success ? stats.itemCount : 0,
  searchCount: search.success ? (search.entries?.length ?? 0) : 0,
  relatedCount: relatedById.success ? (relatedById.entries?.length ?? 0) : 0,
  strictFewer: strict.success && search.success ? (strict.entries?.length ?? 0) <= (search.entries?.length ?? 0) : true,
  addSuccess: addResult.success,
  addBadError: addBad.success === false,
  insightsProjectCount: insights.success ? insights.project_count : 0,
  insightsHasProjects: insights.success ? Array.isArray(insights.projects) : false,
  filteredInsights: insightsFiltered.success ? insightsFiltered.project_count >= 0 : false,
}
```

| Check                  | Expected                                                                  |
| ---------------------- | ------------------------------------------------------------------------- |
| `rebuildSuccess`       | `true`                                                                    |
| `entriesIndexed`       | Number > 0                                                                |
| `vectorAvailable`      | `true`                                                                    |
| `searchCount`          | ≥ 1                                                                       |
| `relatedCount`         | ≥ 1                                                                       |
| `strictFewer`          | `true`                                                                    |
| `addSuccess`           | `true`                                                                    |
| `addBadError`          | `true`                                                                    |
| `insightsHasProjects`  | `true`                                                                    |
| `insightsProjectCount` | ≥ 1 (project 5 visible with seed entries S15–S17; 0 if team seed missing) |
| `filteredInsights`     | `project_count ≥ 0` (≥ 1 if S15–S17 fall within date range)               |



## Success Criteria

- Cross-team search works
- Team analytics works
