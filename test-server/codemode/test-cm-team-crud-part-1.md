# Re-Test memory-journal-mcp — Code Mode: Team CRUD & Search

Test team CRUD operations, error paths, and date range search through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.1–28.3 — ~15 test cases covering team create, read, search, and error paths via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Seed data S13–S14 are personal journal entries with `workspace_id: "test-ws"`, S15–S17 are team DB entries with `workspace_id: "test-ws"`.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 28: Team Tools via Code Mode

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured. If not configured, all team tools should return structured `{ success: false, error: "Team database not configured..." }`.
>
> **`team_delete_entry(workspace_id: "test-ws")` is soft-delete only** — no `permanent` flag.

### 28.1 Team CRUD

```javascript
// Test code:
const created = await mj.team.teamCreateEntry({
  workspace_id: "test-ws",
  content: 'CM4 team entry test',
  tags: ['codemode4-team-test'],
  entry_type: 'standup',
})
if (!created.success) return { createSuccess: false, error: created.error }

const withAuthor = await mj.team.teamCreateEntry({
  workspace_id: "test-ws",
  content: 'CM4 team explicit author',
  author: 'CM4Bot',
})
if (!withAuthor.success) return { explicitAuthorSuccess: false, error: withAuthor.error }

const recent = await mj.team.teamGetRecent({ workspace_id: "test-ws", limit: 5 })
const search = await mj.team.teamSearch({
  workspace_id: "test-ws",
  query: 'CM4 team entry test',
})
const tagSearch = await mj.team.teamSearch({
  workspace_id: "test-ws",
  tags: ['codemode4-team-test'],
})
const combined = await mj.team.teamSearch({
  workspace_id: "test-ws",
  query: 'team',
  tags: ['codemode4-team-test'],
})
const hybridAuto = await mj.team.teamSearch({
  workspace_id: "test-ws",
  query: 'how did we fix performance',
})
const forcedFts = await mj.team.teamSearch({
  workspace_id: "test-ws",
  query: 'CM4',
  mode: 'fts',
})
const noArgs = await mj.team.teamSearch({ workspace_id: "test-ws" })

const crossTeam = await mj.search.crossTeamSearch({ query: 'CM4 team' })
const crossTeamSpecific = await mj.search.crossTeamSearch({ query: 'CM4 team', team_dbs: ['primary'] })


// New: get by ID, list tags
const detail = await mj.team.teamGetEntryById({
  workspace_id: "test-ws",
  entry_id: created.entry.id,
})
const detailNoRels = await mj.team.teamGetEntryById({
  workspace_id: "test-ws",
  entry_id: created.entry.id,
  include_relationships: false,
})
const tags = await mj.team.teamListTags({ workspace_id: "test-ws" })

return {
  createSuccess: created.success,
  createAuthor: created.entry?.author,
  explicitAuthor: withAuthor.entry?.author,
  recentCount: recent.entries?.length ?? 0,
  recentHasAuthor: !!recent.entries?.[0]?.author,
  searchCount: search.entries?.length ?? 0,
  tagSearchCount: tagSearch.entries?.length ?? 0,
  combinedCount: combined.entries?.length ?? 0,
  hybridAutoCount: hybridAuto.entries?.length ?? 0,
  forcedFtsCount: forcedFts.entries?.length ?? 0,
  noArgsCount: noArgs.entries?.length ?? 0,
  crossTeamCount: crossTeam.entries?.length ?? 0,
  crossTeamSpecificCount: crossTeamSpecific.entries?.length ?? 0,

  detailHasEntry: !!detail.entry,
  detailHasImportance: !!detail.importance,
  detailNoRelsEmpty: !detailNoRels.relationships?.length,
  tagCount: tags.tags?.length ?? 0,
}
```

| Check                    | Expected                          |
| ------------------------ | --------------------------------- |
| `createSuccess`          | `true`                            |
| `createAuthor`           | Non-empty string (auto-populated) |
| `explicitAuthor`         | `"CM4Bot"`                        |
| `recentHasAuthor`        | `true`                            |
| `searchCount`            | ≥ 1                               |
| `tagSearchCount`         | ≥ 1                               |
| `hybridAutoCount`        | ≥ 0                               |
| `forcedFtsCount`         | ≥ 1                               |
| `crossTeamCount`         | ≥ 1                               |
| `crossTeamSpecificCount` | ≥ 1                               |

| `detailHasEntry`         | `true`                            |
| `tagCount`               | ≥ 1                               |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- See part 2 for remaining success criteria.
