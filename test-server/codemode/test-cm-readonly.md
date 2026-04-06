# Test memory-journal-mcp — Code Mode: Readonly Mode

Test the readonly mode enforcement: read operations succeed, write operations are blocked, and default mode allows writes.

**Scope:** 1 tool (`mj_execute_code`), Phase 18 — ~8 test cases covering readonly sandbox filtering.

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

## Success Criteria

- [ ] `readonly: true` allows read operations (getRecentEntries, searchEntries, getStatistics)
- [ ] `readonly: true` blocks or errors on write operations (createEntry, updateEntry, deleteEntry)
- [ ] `readonly: false` (default) allows both read and write operations
- [ ] `mj.help()` still works in readonly mode
