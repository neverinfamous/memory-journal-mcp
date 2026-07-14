# Re-Test memory-journal-mcp — Code Mode: Hallucination Smoothing

Test the Code Mode Sandbox resilience, hallucination-smoothing parameter/method aliases, cross-group constructor wiring, and API discovery features.

**Scope:** 1 tool (`mj_execute_code`), Phase 31 (Part 2) — ~15 test cases covering `PARAM_ALIASES`, `METHOD_ALIASES`, Sandbox built-ins, and `context` handling.

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

### 31.3 Cross-Group Constructor Wiring

Test that tools technically defined in one group (e.g. `semantic` or `admin`) but logically related to `core` can be called from `mj.core`.

```javascript
// Test code:

// mj.search.semanticSearch -> mj.search.semanticSearch
const semantic = await mj.search.semanticSearch({ workspace_id: "test-ws", query: 'test' })

// mj.search.getVectorIndexStats -> mj.search.getVectorIndexStats
const vStats = await mj.search.getVectorIndexStats({ workspace_id: "test-ws" })

// mj.admin.searchAuditLog -> mj.admin.searchAuditLog
const audit = await mj.admin.searchAuditLog({ limit: 1 })

// mj.search.listDeletedEntries -> mj.search.listDeletedEntries
const deleted = await mj.search.listDeletedEntries({ workspace_id: "test-ws" })

return {
  semanticSuccess: semantic.success,
  vStatsSuccess: vStats.success,
  auditSuccess: audit.success,
  deletedSuccess: deleted.success
}
```

| Check             | Expected |
| ----------------- | -------- |
| `semanticSuccess` | `true`   |
| `vStatsSuccess`   | `true`   |
| `auditSuccess`    | `true`   |
| `deletedSuccess`  | `true`   |

### 31.4 Sandbox Built-ins & Resilience

Test `context`, globals (`sleep`, `getConfig`), error mapping, and proxy behavior.

```javascript
// Test code:

// 1. Template literal auto-return (no 'return' keyword)
const templateTest = `Auto return template: ${1 + 1}`

// Execute a nested block to test
const result = await (async () => {
  // 2. sleep() / setTimeout globals
  await sleep(10)
  await new Promise(r => setTimeout(r, 10))
  
  // 3. getConfig()
  const cfg = await getConfig()
  
  // 4. readResource URI handler
  let uriError = false
  try {
    await readResource('memory://recent')
  } catch (e) {
    uriError = e.message.includes('mj.core.getRecentEntries')
  }
  
  // 5. Array proxy interception & hardened Code Mode array proxies
  // Use createEntry instead of searchEntries to correctly test Non-Array Proxy Error
  const createResult = await mj.core.createEntry({ workspace_id: "test-ws", content: 'x' })
  let proxyError = false
  try {
    createResult.forEach(item => console.log(item))
  } catch (e) {
    proxyError = e.message.includes('CodeMode Non-Array Proxy Error')
  }
  // cleanup the test entry
  await mj.admin.deleteEntry({ id: createResult.id, permanent: true })
  
  // Newly hardened 'Code Mode' array proxies: test support for .length, [0], .indexOf, .includes, .map, .filter
  const listResult = await mj.search.searchEntries({ workspace_id: "test-ws", limit: 1 })
  let arrayProxiesHardened = false
  try {
    const len = listResult.length
    const item = listResult[0]
    const idx = listResult.indexOf ? listResult.indexOf(item) : -1
    const inc = listResult.includes ? listResult.includes(item) : false
    const mapRes = listResult.map ? listResult.map(x => x) : []
    const filRes = listResult.filter ? listResult.filter(x => true) : []
    arrayProxiesHardened = typeof len === 'number' && Array.isArray(mapRes) && Array.isArray(filRes)
  } catch (e) {
    arrayProxiesHardened = false
  }
  
  // 6. Context parameter
  // Call mj_execute_code explicitly with context="Large context string" before running this
  const hasContext = typeof context !== 'undefined'
  
  return {
    templateValue: templateTest,
    configHasDb: !!cfg.dbPath,
    uriErrorHandled: uriError,
    proxyErrorHandled: proxyError,
    arrayProxiesHardened: arrayProxiesHardened,
    contextAvailable: hasContext
  }
})()

return result
```

| Check                  | Expected |
| ---------------------- | -------- |
| `templateValue`        | `"Auto return template: 2"` |
| `configHasDb`          | `true`   |
| `uriErrorHandled`      | `true` (intercepted URI read) |
| `proxyErrorHandled`    | `true` (intercepted `.forEach`) |
| `arrayProxiesHardened` | `true` (supports `.length`, `[0]`, `.map`, etc.) |
| `contextAvailable`     | `true` (when passed via outer schema) |
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Parameter aliases map successfully (`sort` → `sortBy`, `version` → `expectedVersion`, `search`/`q` → `query`, `text`/`message` → `content`, `mode` → `instruction_level`, `filename` → `source_dir`)
- Method aliases map successfully (`mj.admin.updateConfiguration`, `mj.core.getEntryHistory`, `mj.team.teamUpdateMemberRole`, `mj.team.teamListAuthorAliases`, `mj.search.searchEntries`)
- Cross-group constructor wiring works (`mj.search.semanticSearch`, `mj.search.getVectorIndexStats`, `mj.admin.searchAuditLog`, `mj.search.listDeletedEntries`)
- `sleep()` and `setTimeout` globals exist and resolve in Sandbox
- `await getConfig()` returns server configuration inside Sandbox
- `readResource("memory://...")` throws a structured guidance error pointing to tools
- Calling `.forEach()` on a tool response object throws a specific `CodeMode Non-Array Proxy Error`
- Newly hardened array proxies support `.length`, `[0]`, `.indexOf`, `.includes`, `.map`, and `.filter` natively
- The outer `context` parameter value is accessible inside the Sandbox via the `context` variable
- Multi-line template literals automatically return without a `return` statement
