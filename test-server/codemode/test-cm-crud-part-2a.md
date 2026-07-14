# Re-Test memory-journal-mcp — Code Mode: Core CRUD

Test core CRUD operations through the Code Mode `mj.*` API bridge: create, read, update, delete with full parameters and error paths.

**Scope:** 1 tool (`mj_execute_code`), Phase 20 — ~15 test cases covering CRUD via Code Mode.

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
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 20: Core CRUD via Code Mode

### 20.6 Update Entry — Error Paths

| Test               | Code                                                                         | Expected Result                                       |
| ------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Nonexistent ID     | `return await mj.admin.updateEntry({ id: 999999, content: "fail" });`  | `{ success: false, error: "Entry 999999 not found" }` |
| Invalid type | `return await mj.admin.updateEntry({ id: 1, type: "invalid" });` | `{ success: false, error: "..." }`                    |
| Expect Version Error | `return await mj.admin.updateEntry({ id: 1, expectedVersion: 0 });` | `true` (throws VALIDATION_ERROR) |

### 20.7 Delete Entry

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 delete test' })
const id = created.entry.id
const soft = await mj.admin.deleteEntry({ id: id, permanent: false })
const searchAfterSoft = await mj.search.searchEntries({
  workspace_id: "test-ws",
  query: 'CM3 delete test',
  limit: 5,
})
const hiddenFromSearch = !searchAfterSoft.entries.some((e) => e.id === id)
const perm = await mj.admin.deleteEntry({ id: id, permanent: true })
const notFound = await mj.admin.deleteEntry({ id: 999999 })
return {
  softSuccess: soft.success,
  hiddenFromSearch,
  permSuccess: perm.success,
  notFoundError: notFound.success === false,
}
```

| Check              | Expected |
| ------------------ | -------- |
| `softSuccess`      | `true`   |
| `hiddenFromSearch` | `true`   |
| `permSuccess`      | `true`   |
| `notFoundError`    | `true`   |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.
- See part 2 for remaining success criteria.
