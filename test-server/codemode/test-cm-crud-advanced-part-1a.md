# Re-Test memory-journal-mcp — Code Mode: Core CRUD Advanced

Test core CRUD operations through the Code Mode mj.* API bridge (Advanced cases).

**Scope:** 1 tool (mj_execute_code), Phase 20B — ~9 test cases.

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

## Phase 20B: Core CRUD Advanced via Code Mode

### 20.11 Update Entry — isPersonal Toggle

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 personal toggle test' })
const id = created.entry.id

// Toggle to non-personal
const toggled = await mj.admin.updateEntry({ id: id, isPersonal: false })
const verify1 = await mj.core.getEntryById({ id: id })

// Toggle back to personal
const toggledBack = await mj.admin.updateEntry({ id: id, isPersonal: true })
const verify2 = await mj.core.getEntryById({ id: id })

return {
  toggleSuccess: toggled.success,
  isPersonalFalse: verify1.entry?.isPersonal === false,
  toggleBackSuccess: toggledBack.success,
  isPersonalTrue: verify2.entry?.isPersonal === true,
}
```

| Check               | Expected |
| ------------------- | -------- |
| `toggleSuccess`     | `true`   |
| `isPersonalFalse`   | `true`   |
| `toggleBackSuccess` | `true`   |
| `isPersonalTrue`    | `true`   |

### 20.12 Create Entry — issueUrl Auto-Population

| Test                    | Code                                                                                                                                                                                                                                       | Expected Result                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| issueUrl auto-populated | `const ctx = await mj.github.getGithubContext({}); const r = await mj.core.createEntry({ workspace_id: "test-ws", content: "CM3 issue link", issueNumber: 1 }); return { success: r.success, issueUrl: r.entry?.issueUrl };` | `success: true`, `issueUrl` contains github URL or is auto-populated |

### 20.13 Get Entry History

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 history test v1' })
const id = created.entry.id

await mj.admin.updateEntry({ id: id, content: 'CM3 history test v2' })
await mj.admin.updateEntry({ id: id, content: 'CM3 history test v3' })

const history = await mj.core.getEntryHistory({ id: id })

return {
  historyCount: history.revisions?.length,
  firstRevNumber: history.revisions?.[0]?.revisionNumber,
  firstRevContent: history.revisions?.[0]?.contentSnapshot,
  secondRevNumber: history.revisions?.[1]?.revisionNumber,
  secondRevContent: history.revisions?.[1]?.contentSnapshot,
}
```

| Check              | Expected                |
| ------------------ | ----------------------- |
| `historyCount`     | `2`                     |
| `firstRevNumber`   | `2`                     |
| `firstRevContent`  | `"CM3 history test v2"` |
| `secondRevNumber`  | `1`                     |
| `secondRevContent` | `"CM3 history test v1"` |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.
- See part 2 for remaining success criteria.
