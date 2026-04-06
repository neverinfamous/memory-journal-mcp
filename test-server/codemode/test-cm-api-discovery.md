# Test memory-journal-mcp — Code Mode: API Discoverability

Test the `mj.*` API bridge discoverability: top-level help, per-group help, method aliases, and positional argument support.

**Scope:** 1 tool (`mj_execute_code`), Phase 17 — ~12 test cases covering API proxy construction and discoverability.

**Prerequisites:**

- Phase 16 (Sandbox Basics) must pass first.
- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `server-instructions.md`/`server-instructions.ts` or this file.
2. Use `code-map.md` as a source of truth and ensure fixes comply with `C:\Users\chris\Desktop\adamic\skills\mcp-builder`.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the user can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   * **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Read `memory://briefing` to confirm context loaded (the briefing table confirms receipt).

---

## Phase 17: API Discoverability

### 17.1 Top-Level Help

| Test                     | Code                                                 | Expected Result                                                                                         |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| mj.help() returns groups | `return await mj.help();`                            | `groups` array with 9 entries, `totalMethods` > 40, `usage` string                                      |
| All 9 groups present     | `const h = await mj.help(); return h.groups;`        | Contains: `core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`, `team` |
| Correct group count      | `const h = await mj.help(); return h.groups.length;` | `9`                                                                                                     |

### 17.2 Per-Group Help

| Test             | Code                                | Expected Result                                         |
| ---------------- | ----------------------------------- | ------------------------------------------------------- |
| core.help()      | `return await mj.core.help();`      | `group: "core"`, `methods` array with core method names |
| search.help()    | `return await mj.search.help();`    | `group: "search"`, `methods` array                      |
| analytics.help() | `return await mj.analytics.help();` | `group: "analytics"`, `methods` array                   |
| github.help()    | `return await mj.github.help();`    | `group: "github"`, `methods` array                      |
| backup.help()    | `return await mj.backup.help();`    | `group: "backup"`, `methods` array                      |

### 17.3 Aliases & Positional Arguments

| Test                        | Code                                                                                                                                          | Expected Result                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Alias: mj.core.recent()     | `const r = await mj.core.recent(2); return { count: r.entries?.length ?? r.count };`                                                          | Returns entries (alias for `getRecentEntries`)    |
| Alias: mj.core.getRecent()  | `const r = await mj.core.getRecent({limit: 2}); return { count: r.entries?.length ?? r.count };`                                              | Returns entries (alias for `getRecentEntries`)    |
| Alias: mj.analytics.stats() | `const s = await mj.analytics.stats(); return typeof s.totalEntries;`                                                                         | Returns `"number"` (alias for `getStatistics`)    |
| Positional: mj.core.get(id) | `const r = await mj.core.getRecentEntries({limit:1}); const id = r.entries[0].id; const e = await mj.core.get(id); return { hasEntry: !!e };` | Returns the entry (positional for `getEntryById`) |

---

## Success Criteria

- [ ] `mj.help()` returns all 9 groups with correct `totalMethods` count
- [ ] Per-group `help()` returns method names for each group
- [ ] Method aliases work (e.g., `mj.core.recent()`, `mj.analytics.stats()`)
- [ ] Positional arguments work (e.g., `mj.core.get(id)`)
