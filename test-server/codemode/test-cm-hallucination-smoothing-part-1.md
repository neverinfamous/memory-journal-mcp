# Re-Test memory-journal-mcp — Code Mode: Hallucination Smoothing

Test the Code Mode Sandbox resilience, hallucination-smoothing parameter/method aliases, cross-group constructor wiring, and API discovery features.

**Scope:** 1 tool (`mj_execute_code`), Phase 31 — ~15 test cases covering `PARAM_ALIASES`, `METHOD_ALIASES`, Sandbox built-ins, and `context` handling.

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

## Phase 31: Hallucination Smoothing & Sandbox Resilience

### 31.1 Parameter Aliases (PARAM_ALIASES)

Test that common agent hallucinations (`user`, `msg`, `severity`, `version`, `search`, etc.) map correctly to the true parameter names.

```javascript
// Test code:
// 1. sort -> sortBy
const listSort = await mj.team.teamSearch({
  workspace_id: "test-ws",
  sort: 'priority'
})

// 2. version -> expectedVersion, text/message -> content
const entry = await mj.core.createEntry({ workspace_id: "test-ws", text: 'Alias entry' })
const updated = await mj.admin.updateEntry({
  id: entry.id,
  message: 'Updated alias',
  version: entry.version
})

// 3. search/q -> query, mode -> instruction_level
const searched = await mj.search.searchEntries({
  workspace_id: "test-ws",
  q: 'Alias'
})
const configMode = await mj.admin.updateConfiguration({ mode: 'standard' })

// 4. filename -> source_dir (for io import)
let ioError = false;
const ioRes = await mj.io.importExternal({ workspace_id: "test-ws", filename: '/fake/dir' });
if (!ioRes.success && !ioRes.error.includes('source_dir')) {
  ioError = true; // Expect structured error but not validation error about missing source_dir
}

// Cleanup
await mj.admin.deleteEntry({ id: entry.id, permanent: true })

return {
  listSortMapped: listSort.success && Array.isArray(listSort.entries),
  versionMapped: updated.success,
  searchMapped: searched.success && searched.count > 0,
  modeMapped: configMode.success,
  filenameMapped: ioError // If it threw, it passed validation
}
```

| Check                  | Expected |
| ---------------------- | -------- |
| `listSortMapped`       | `true`   |
| `versionMapped`        | `true`   |
| `searchMapped`         | `true`   |
| `modeMapped`           | `true`   |
| `filenameMapped`       | `true`   |

### 31.2 Method Aliases & read_query Wrapper

```javascript
// Test code:

// mj.admin.updateConfiguration -> updateConfiguration
const c1 = await mj.admin.updateConfiguration({ briefing_entries: 5 })
const c2 = await mj.admin.updateConfiguration({ briefing_entries: 4 })

// mj.core.getEntryHistory -> getEntryHistory
const entry = await mj.core.createEntry({ workspace_id: "test-ws", content: 'History test' })
await mj.admin.updateEntry({ id: entry.id, content: 'History test updated' })
const history = await mj.core.getEntryHistory({ id: entry.id })

// Team Aliases
const role = await mj.team.teamUpdateMemberRole({ target_user: 'tester99', role: 'contributor' })
const aliases = await mj.team.teamListAuthorAliases({})

// mj.search.searchEntries / readQuery -> searchEntries
const readQ1 = await mj.search.searchEntries({ workspace_id: "test-ws", query: 'History test' })
const readQ2 = await mj.search.searchEntries({ workspace_id: "test-ws", query: 'History test' })

// Cleanup
await mj.admin.deleteEntry({ id: entry.id, permanent: true })

return {
  configAlias: c1.success && c2.success,
  historyAlias: history.revisions?.length > 0,
  teamRoleAlias: role.success,
  teamAliasesAlias: aliases.success,
  readQueryAlias: readQ1.success,
  readQuerySnake: readQ2.success
}
```

| Check              | Expected |
| ------------------ | -------- |
| `configAlias`      | `true`   |
| `historyAlias`     | `true`   |
| `teamRoleAlias`    | `true`   |
| `teamAliasesAlias` | `true`   |
| `readQueryAlias`   | `true`   |
| `readQuerySnake`   | `true`   |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.
- See part 2 for remaining success criteria.
