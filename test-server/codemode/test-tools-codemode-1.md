# Test memory-journal-mcp — Code Mode Part 1: Foundations & Security

Test the Code Mode sandbox (`mj_execute_code`), API observability, and security constraints through the `mj.*` API bridge.

**Scope:** 1 tool (`mj_execute_code`), test scenarios across 4 phases (Phases 16-19) covering sandbox execution, API discoverability, readonly mode, and security — all via Code Mode.

**Prerequisites:**

- Pass 1 must have completed successfully (seed data S1-S12 exists).
- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `server-instructions.md`/`server-instructions.ts` or this file (`test-server/test-tools-codemode-1.md`).
2. Use `code-map.md` as a source of truth and ensure fixes comply with `C:\Users\chris\Desktop\adamic\skills\mcp-builder`.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the user can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Read `memory://briefing` to confirm context loaded (the briefing table confirms receipt).

---

## Phase 16: Sandbox Basics

### 16.1 Simple Expressions

| Test            | Code                             | Expected Result                                             |
| --------------- | -------------------------------- | ----------------------------------------------------------- |
| Integer return  | `return 42;`                     | `{ success: true, result: 42 }`                             |
| String return   | `return "hello from code mode";` | `{ success: true, result: "hello from code mode" }`         |
| Object return   | `return { a: 1, b: [2, 3] };`    | `{ success: true, result: { a: 1, b: [2, 3] } }`            |
| Null return     | `return null;`                   | `{ success: true, result: null }`                           |
| No return value | `const x = 1;`                   | `{ success: true, result: undefined }` (implicit undefined) |
| Boolean return  | `return true;`                   | `{ success: true, result: true }`                           |

### 16.2 Async & Built-ins

| Test              | Code                                                 | Expected Result                             |
| ----------------- | ---------------------------------------------------- | ------------------------------------------- |
| Async/await       | `const x = await Promise.resolve(42); return x;`     | `{ success: true, result: 42 }`             |
| JSON built-in     | `return JSON.parse('{"test": true}');`               | `{ success: true, result: { test: true } }` |
| Math built-in     | `return Math.max(1, 2, 3);`                          | `{ success: true, result: 3 }`              |
| Array methods     | `return [3,1,2].sort();`                             | `{ success: true, result: [1, 2, 3] }`      |
| Date available    | `return typeof Date;`                                | `{ success: true, result: "function" }`     |
| Map/Set available | `const m = new Map(); m.set("a", 1); return m.size;` | `{ success: true, result: 1 }`              |
| RegExp available  | `return /test/.test("testing");`                     | `{ success: true, result: true }`           |

### 16.3 Execution Metrics

| Test                 | Code        | Expected Result                                                       |
| -------------------- | ----------- | --------------------------------------------------------------------- |
| Metrics present      | `return 1;` | Response has `metrics` with `wallTimeMs`, `cpuTimeMs`, `memoryUsedMb` |
| wallTimeMs > 0       | `return 1;` | `metrics.wallTimeMs >= 0` (typically > 0)                             |
| cpuTimeMs numeric    | `return 1;` | `metrics.cpuTimeMs` is a number                                       |
| memoryUsedMb numeric | `return 1;` | `metrics.memoryUsedMb` is a number                                    |

### 16.4 Timeout Handling

| Test                    | Code                                  | Expected Result                                            |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Custom timeout succeeds | `return "fast";` with `timeout: 5000` | `{ success: true, result: "fast" }`                        |
| Infinite loop timeout   | `while(true) {}` with `timeout: 2000` | `{ success: false, error: "..." }` with timeout indication |

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

## Phase 18: Readonly Mode

> [!NOTE]
> When `readonly: true`, only tools with `readOnlyHint: true` are available. Write tools should be filtered out of the API bridge.

### 18.1 Read Operations Succeed

| Test               | Code (readonly: true)                                              | Expected Result                       |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------- |
| Get recent entries | `return await mj.core.getRecentEntries({limit: 2});`               | `{ success: true }`, entries returned |
| Search entries     | `return await mj.search.searchEntries({query: "test", limit: 2});` | `{ success: true }`, search works     |
| Get statistics     | `return await mj.analytics.getStatistics({});`                     | `{ success: true }`, stats returned   |
| Help still works   | `return await mj.help();`                                          | Groups and methods listed             |

### 18.2 Write Operations Blocked

| Test                 | Code (readonly: true)                                                | Expected Result                                                     |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Create entry blocked | `return await mj.core.createEntry({content: "should fail"});`        | ⚠️ Verify: either method doesn't exist (TypeError) or returns error |
| Update entry blocked | `return await mj.admin.updateEntry({entry_id: 1, content: "fail"});` | ⚠️ Verify: blocked or error                                         |
| Delete entry blocked | `return await mj.admin.deleteEntry({entry_id: 999999});`             | ⚠️ Verify: blocked or error                                         |

### 18.3 Default Mode Allows Writes

| Test                    | Code (readonly: false, default)                                                                                                 | Expected Result                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Create works in default | `const r = await mj.core.createEntryMinimal({content: "readonly=false test"}); return { success: r.success, id: r.entry?.id };` | `success: true`, entry created |

---

## Phase 19: Error Handling & Security

### 19.1 Input Validation

| Test            | Input                               | Expected Result                                               |
| --------------- | ----------------------------------- | ------------------------------------------------------------- |
| Empty code      | `code: ""`                          | `{ success: false, error: "..." }` — pre-execution validation |
| Whitespace only | `code: "   "` (if treated as empty) | Structured error or executes with `undefined` result          |

### 19.2 Blocked Patterns

| Test                 | Code                         | Expected Result                                      |
| -------------------- | ---------------------------- | ---------------------------------------------------- |
| require()            | `require('fs')`              | `{ success: false, error: "..." }` — blocked pattern |
| process.exit         | `process.exit(1)`            | `{ success: false, error: "..." }` — blocked pattern |
| eval()               | `eval('1+1')`                | `{ success: false, error: "..." }` — blocked pattern |
| import()             | `import('fs')`               | `{ success: false, error: "..." }` — blocked pattern |
| Function constructor | `new Function('return 1')()` | `{ success: false, error: "..." }` — blocked pattern |
| **proto**            | `({}).__proto__`             | `{ success: false, error: "..." }` — blocked pattern |
| child_process        | `require('child_process')`   | `{ success: false, error: "..." }` — blocked pattern |

### 19.3 Runtime Errors

| Test                 | Code                                        | Expected Result                                              |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| Syntax error         | `{{{`                                       | `{ success: false, error: "..." }` with syntax error message |
| ReferenceError       | `return nonexistentVariable;`               | `{ success: false, error: "..." }` with ReferenceError       |
| TypeError in code    | `null.foo()`                                | `{ success: false, error: "..." }` with TypeError            |
| RPC method not found | `return await mj.core.nonexistentMethod();` | `{ success: false }` — method not found in group             |

### 19.4 Nulled Globals

| Test                    | Code                        | Expected Result       |
| ----------------------- | --------------------------- | --------------------- |
| process is undefined    | `return typeof process;`    | `result: "undefined"` |
| require is undefined    | `return typeof require;`    | `result: "undefined"` |
| setTimeout is undefined | `return typeof setTimeout;` | `result: "undefined"` |
| globalThis is undefined | `return typeof globalThis;` | `result: "undefined"` |

---

## Test Execution Order

1. **Phase 16**: Sandbox Basics (must pass before proceeding)
2. **Phase 17**: API Discoverability (verifies mj.* proxy construction)
3. **Phase 18**: Readonly Mode (verifies write filtering)
4. **Phase 19**: Error Handling & Security (blocked patterns, runtime errors)

---

## Success Criteria

### Sandbox Basics (Phase 16)

- [ ] Simple expressions return correct types: integer, string, object, null, boolean
- [ ] Async/await resolves correctly inside sandbox
- [ ] Built-in constructors available: JSON, Math, Date, Array, Map, Set, RegExp
- [ ] `metrics` field present with `wallTimeMs`, `cpuTimeMs`, `memoryUsedMb`
- [ ] Custom `timeout` parameter accepted and enforced
- [ ] Infinite loop terminated with structured error (not hang or crash)

### API Discoverability (Phase 17)

- [ ] `mj.help()` returns all 9 groups with correct `totalMethods` count
- [ ] Per-group `help()` returns method names for each group
- [ ] Method aliases work (e.g., `mj.core.recent()`, `mj.analytics.stats()`)
- [ ] Positional arguments work (e.g., `mj.core.get(id)`)

### Readonly Mode (Phase 18)

- [ ] `readonly: true` allows read operations (getRecentEntries, searchEntries, getStatistics)
- [ ] `readonly: true` blocks or errors on write operations (createEntry, updateEntry, deleteEntry)
- [ ] `readonly: false` (default) allows both read and write operations
- [ ] `mj.help()` still works in readonly mode

### Error Handling & Security (Phase 19)

- [ ] Empty code returns structured error (not raw MCP error)
- [ ] All 7 blocked patterns (`require`, `process`, `eval`, `import`, `Function`, `__proto__`, `child_process`) return structured security errors
- [ ] Syntax errors return `{ success: false, error: "..." }` with descriptive message
- [ ] Runtime errors (ReferenceError, TypeError) caught and returned as structured errors
- [ ] Nulled globals confirmed: `process`, `require`, `setTimeout`, `globalThis` are all `undefined`
