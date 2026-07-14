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

### 20.1 Create Entry — Full Parameters

```javascript
// Test code:
const entry = await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'CM3 full-params test entry',
  type: 'technical_note',
  tags: ['codemode3-test', 'full-params'],
  prNumber: 99,
  prStatus: 'open',
  workflowRunId: 555,
  workflow_name: 'test-ci',
  workflow_status: 'completed',
  isPersonal: false,
})
return {
  success: entry.success,
  id: entry.entry?.id,
  type: entry.entry?.entryType,
  prNumber: entry.entry?.prNumber,
  prStatus: entry.entry?.prStatus,
  workflowRunId: entry.entry?.workflowRunId,
  workflowName: entry.entry?.workflowName,
  workflowStatus: entry.entry?.workflowStatus,
  projectNumber: entry.entry?.projectNumber,
  isPersonal: entry.entry?.isPersonal,
}
```

| Check            | Expected           |
| ---------------- | ------------------ |
| `success`        | `true`             |
| `type`           | `"technical_note"` |
| `prNumber`       | `99`               |
| `prStatus`       | `"open"`           |
| `workflowRunId`  | `555`              |
| `workflowName`   | `"test-ci"`        |
| `workflowStatus` | `"completed"`      |
| `projectNumber`  | `5`                |
| `isPersonal`     | `false`            |

### 20.2 Create with share_with_team

```javascript
// Test code:
const entry = await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'CM3 shared entry for team verification',
  share_with_team: true,
  tags: ['codemode3-team'],
})
return {
  success: entry.success,
  sharedWithTeam: entry.sharedWithTeam,
  author: entry.author,
  entryId: entry.entry?.id,
}
```

| Check            | Expected         |
| ---------------- | ---------------- |
| `success`        | `true`           |
| `sharedWithTeam` | `true`           |
| `author`         | Non-empty string |

### 20.2.1 Create with workspace_id and Verify Isolation

```javascript
// Test code:
// Create an entry in workspace ws-a
const entryA = await mj.core.createEntry({
  content: 'CM3 workspace-a entry',
  workspace_id: 'ws-a'
})

// Search in workspace ws-b (should be empty for our string)
const searchB = await mj.search.searchEntries({
  query: 'CM3 workspace-a entry',
  workspace_id: 'ws-b'
})

// Get recent from workspace ws-a (should contain the entry)
const recentA = await mj.core.getRecentEntries({
  limit: 10,
  workspace_id: 'ws-a'
})

return {
  success: entryA.success,
  workspaceA: entryA.entry?.workspaceId,
  searchBCount: searchB.count,
  recentAContains: recentA.entries?.some(e => e.content === 'CM3 workspace-a entry')
}
```

| Check             | Expected |
| ----------------- | -------- |
| `success`         | `true`   |
| `workspaceA`      | `"ws-a"` |
| `searchBCount`    | `0`      |
| `recentAContains` | `true`   |

### 20.3 Create Entry — Error Paths

| Test                 | Code                                                                                                      | Expected Result                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Invalid type   | `return await mj.core.createEntry({ workspace_id: "test-ws", content: "test", type: "invalid" });`        | `{ success: false, error: "..." }` listing valid types |
| Invalid significance | `return await mj.core.createEntry({ workspace_id: "test-ws", content: "test", significance_type: "invalid" });` | `{ success: false, error: "..." }` listing valid types |
| Empty content        | `return await mj.core.createEntry({ workspace_id: "test-ws", content: "" });`                                   | `{ success: false, error: "..." }` min length error    |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.
- See part 2 for remaining success criteria.
