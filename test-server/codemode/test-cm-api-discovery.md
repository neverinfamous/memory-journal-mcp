# Re-Test memory-journal-mcp — Code Mode: API Discoverability

Test the `mj.*` API bridge discoverability: top-level help, per-group help, method aliases, and positional argument support.

**Scope:** 1 tool (`mj_execute_code`), Phase 17 — ~12 test cases covering API proxy construction and discoverability.

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

## Phase 17: API Discoverability

### 17.1 Top-Level Help

| Test                     | Code                                                 | Expected Result                                                                                               |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| mj.help() returns groups | `return await mj.help();`                            | `groups` array with 10 entries, `totalMethods` > 40, `usage` string                                           |
| All 10 groups present    | `const h = await mj.help(); return h.groups;`        | Contains: `core`, `search`, `analytics`, `relationships`, `io`, `export`, `admin`, `github`, `backup`, `team` |
| Correct group count      | `const h = await mj.help(); return h.groups.length;` | `10`                                                                                                          |

### 17.2 Per-Group Help

| Test             | Code                                | Expected Result                                         |
| ---------------- | ----------------------------------- | ------------------------------------------------------- |
| core.help()      | `return await mj.core.help();`      | `group: "core"`, `methods` array with core method names |
| search.help()    | `return await mj.search.help();`    | `group: "search"`, `methods` array                      |
| analytics.help() | `return await mj.analytics.help();` | `group: "analytics"`, `methods` array                   |
| github.help()    | `return await mj.github.help();`    | `group: "github"`, `methods` array                      |
| backup.help()    | `return await mj.backup.help();`    | `group: "backup"`, `methods` array                      |

### 17.3 Aliases & Positional Arguments

| Test                        | Code                                                                                                                                                             | Expected Result                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Alias: mj.core.getRecentEntries()     | `const r = await mj.core.getRecentEntries(2); return { count: r.entries?.length ?? r.count };`                                                                             | Returns entries (alias for `getRecentEntries`)    |
| Alias: mj.core.getRecent()  | `const r = await mj.core.getRecent({limit: 2}); return { count: r.entries?.length ?? r.count };`                                                                 | Returns entries (alias for `getRecentEntries`)    |
| Alias: mj.analytics.getStatistics() | `const s = await mj.analytics.getStatistics(); return typeof s.totalEntries;`                                                                                            | Returns `"number"` (alias for `getStatistics`)    |
| Positional: mj.core.getEntryById(id) | `const r = await mj.core.getRecentEntries({workspace_id: "test-ws", limit:1}); const id = r.entries[0].id; const e = await mj.core.getEntryById(id); return { hasEntry: !!e };` | Returns the entry (positional for `getEntryById`) |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `mj.help()` returns all 10 groups with correct `totalMethods` count
- Per-group `help()` returns method names for each group
- Method aliases work (e.g., `mj.core.getRecentEntries()`, `mj.analytics.getStatistics()`)
- Positional arguments work (e.g., `mj.core.getEntryById(id)`)
