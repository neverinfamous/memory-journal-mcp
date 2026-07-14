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
  
  linkEmptyError: linkEmpty.success === false,
  backupOk: backupEmpty.success === false || backupEmpty.success === true,
  semanticEmptyError: semanticEmpty.success === false,
  statsOk: statsEmpty.success === false || typeof statsEmpty.totalEntries === 'number',
  insightsOk: insightsEmpty.success === false || typeof insightsEmpty.project_count === 'number',
  createNumContentError: createNumContent.success === false,
  updateStrIdError: updateStrId.success === false,
  teamSearchTypeMismatchError: teamSearchTypeMismatch.success === false,
  crossTeamSearchTypeMismatchError: crossTeamSearchTypeMismatch.success === false,
}
```

| Check                   | Expected                              |
| ----------------------- | ------------------------------------- |
| `linkEmptyError`        | `true` (from/to id required)    |
| `createNumContentError` | `true` (content must be string)       |
| `teamSearchTypeMismatchError` | `true` (type mismatches caught) |
| `crossTeamSearchTypeMismatchError` | `true` (type mismatches caught) |


