# Re-Test memory-journal-mcp — Code Mode: Readonly Mode

Test the readonly mode enforcement: read operations succeed, write operations are blocked, and default mode allows writes.

**Scope:** 1 tool (`mj_execute_code`), Phase 18 — ~8 test cases covering readonly sandbox filtering.

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

## Phase 18: Readonly Mode

> [!NOTE]
> When `readonly: true`, only tools with `readOnlyHint: true` are available. Write tools should be filtered out of the API bridge.

### 18.1 Read Operations Succeed

| Test               | Code (readonly: true)                                                                 | Expected Result               |
| ------------------ | ------------------------------------------------------------------------------------- | ----------------------------- |
| Get recent entries | `return await mj.core.getRecentEntries({workspace_id: "test-ws", limit: 2});`               | `{ count, entries }` returned |
| Search entries     | `return await mj.search.searchEntries({workspace_id: "test-ws", query: "test", limit: 2});` | `{ count, entries }` returned |
| Get statistics     | `return await mj.analytics.getStatistics({});`                                        | data returned                 |
| Help still works   | `return await mj.help();`                                                             | Groups and methods listed     |

### 18.2 Write Operations Blocked

| Test                 | Code (readonly: true)                                                            | Expected Result                                                     |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Create entry blocked | `return await mj.core.createEntry({workspace_id: "test-ws", content: "should fail"});` | ⚠️ Verify: either method doesn't exist (TypeError) or returns error |
| Update entry blocked | `return await mj.admin.updateEntry({entry_id: 1, content: "fail"});`             | ⚠️ Verify: blocked or error                                         |
| Delete entry blocked | `return await mj.admin.deleteEntry({entry_id: 999999, expected_version: 1});`                         | ⚠️ Verify: blocked or error                                         |

### 18.3 Default Mode Allows Writes

| Test                    | Code (readonly: false, default)                                                                                                 | Expected Result                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Create works in default | `const r = await mj.core.createEntry({ workspace_id: "test-ws", content: "readonly=false test"}); return { success: r.success, id: r.entry?.id };` | `success: true`, entry created |

### 18.4 Cleanup

| Test                   | Code                                                                      | Expected Result |
| ---------------------- | ------------------------------------------------------------------------- | --------------- |
| Clean up test artifact | `return await mj.admin.deleteEntry({entry_id: <ID_FROM_PREVIOUS_STEP>, expected_version: 1});` | `success: true` |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `readonly: true` allows read operations (getRecentEntries, searchEntries, getStatistics)
- `readonly: true` blocks or errors on write operations (createEntry, updateEntry, deleteEntry)
- `readonly: false` (default) allows both read and write operations
- `mj.help()` still works in readonly mode
- Test artifact created in 18.3 is successfully deleted in 18.4
