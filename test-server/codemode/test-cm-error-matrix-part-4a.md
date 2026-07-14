# Re-Test memory-journal-mcp — Code Mode: Error Matrix & Zod Sweeps (Part 2)

Systematic verification of structured error handling across remaining API groups.

**Scope:** 1 tool (mj_execute_code), Phase 29B.

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

## Phase 29B: Error Matrix via Code Mode (Continued)



### 29.7 Team Group — Empty Params & DB Not Configured

```javascript
// Test code:
const createEmpty = await mj.team.teamCreateEntry({ workspace_id: "test-ws" })
const getByIdEmpty = await mj.team.teamGetEntryById({ workspace_id: "test-ws" })
const recentEmpty = await mj.team.teamGetRecent({ workspace_id: "test-ws" })
const searchEmpty = await mj.team.teamSearch({ workspace_id: "test-ws" })
const tagsEmpty = await mj.team.teamListTags({})
const dateRangeEmpty = await mj.team.teamSearchByDateRange({ workspace_id: "test-ws" })
const updateEmpty = await mj.team.teamUpdateEntry({ workspace_id: "test-ws" })
const deleteEmpty = await mj.team.teamDeleteEntry({ workspace_id: "test-ws" })
const mergeEmpty = await mj.team.teamMergeTags({ workspace_id: "test-ws" })
const linkEmpty = await mj.team.teamLinkEntries({ workspace_id: "test-ws" })
const vizEmpty = await mj.team.teamVisualizeRelationships({ workspace_id: "test-ws" })
const exportEmpty = await mj.team.teamExportEntries({ workspace_id: "test-ws" })
const backupEmpty = await mj.team.teamBackup({})
const listBackupsEmpty = await mj.team.teamListBackups({})
const semanticEmpty = await mj.team.teamSemanticSearch({ workspace_id: "test-ws" })
const vecStatsEmpty = await mj.team.teamGetVectorIndexStats({})
const statsEmpty = await mj.team.teamGetStatistics({})
const insightsEmpty = await mj.team.teamGetCrossProjectInsights({})
const crossTeamSearchTypeMismatch = await mj.search.crossTeamSearch({ team_dbs: "invalid_type" })

// Type mismatches
const createNumContent = await mj.team.teamCreateEntry({
  workspace_id: "test-ws",
  content: 123,
})
const updateStrId = await mj.team.teamUpdateEntry({
  workspace_id: "test-ws",
  id: 'abc',
  content: 'test',
})
const teamSearchTypeMismatch = await mj.team.teamSearch({ workspace_id: "test-ws", query: 123 })

return {
  createEmptyError: createEmpty.success === false,
  getByIdEmptyError: getByIdEmpty.success === false,
  recentOk: recentEmpty.success === false || Array.isArray(recentEmpty.entries),
  searchHandled: searchEmpty.success === false || Array.isArray(searchEmpty.entries),
  tagsOk: tagsEmpty.success === false || Array.isArray(tagsEmpty.tags),
  dateRangeEmptyError: dateRangeEmpty.success === false,
  updateEmptyError: updateEmpty.success === false,
  deleteEmptyError: deleteEmpty.success === false,
  mergeEmptyError: mergeEmpty.success === false,
  
}
```

| Check                   | Expected                              |
| ----------------------- | ------------------------------------- |
| `createEmptyError`      | `true` (content required)             |
| `getByIdEmptyError`     | `true` (id required)            |
| `recentOk`              | `true` (uses defaults)                |
| `tagsOk`                | `true` (no params needed)             |
| `dateRangeEmptyError`   | `true` (start/end date required)      |
| `updateEmptyError`      | `true` (id required)            |
| `deleteEmptyError`      | `true` (id required)            |
| `mergeEmptyError`       | `true` (source/target required)       |
