# Re-Test memory-journal-mcp — Code Mode: Admin Batch & Telemetry

Test batch operations and audit telemetry via Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 27.3, 27.4 — ~6 test cases.

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

## Phase 27: Admin Batch & Telemetry via Code Mode

### 27.3 Admin Batch Operations

```javascript
// Test code:
// Batch Create
const bCreated = await mj.admin.batchCreateEntries({
  entries: [
    { workspace_id: "test-ws", content: 'CM4 batch entry 1' },
    { workspace_id: "test-ws", content: 'CM4 batch entry 2' }
  ]
})
const [id1, id2] = bCreated.entryIds

// Batch Update
const bUpdated = await mj.admin.batchUpdateEntries({
  updates: [
    { id: id1, content: 'CM4 batch entry 1 updated' }
  ]
})

// Batch Delete
const bDeleted = await mj.admin.batchDeleteEntries({
  entry_ids: [id1, id2]
})

// Verify Aliases (Hallucination Fallbacks)
const bAliasCreated = await mj.admin.batchCreateEntries({
  entries: [
    { workspace_id: "test-ws", content: 'CM4 alias entry 1' }
  ]
})
await mj.admin.batchDeleteEntries({
  entry_ids: bAliasCreated.entryIds
})

return {
  bCreateSuccess: bCreated.success,
  bCreateCount: bCreated.entryIds?.length === 2,
  bUpdateSuccess: bUpdated.success,
  bDeleteSuccess: bDeleted.success,
  bDeleteCount: bDeleted.deletedCount === 2,
  aliasSuccess: bAliasCreated.success
}
```

| Check              | Expected |
| ------------------ | -------- |
| `bCreateSuccess`   | `true`   |
| `bCreateCount`     | `true`   |
| `bUpdateSuccess`   | `true`   |
| `bDeleteSuccess`   | `true`   |
| `bDeleteCount`     | `true`   |
| `aliasSuccess`     | `true`   |

### 27.4 Audit Telemetry

```javascript
// Test code:
// Search by tool
const auditByTool = await mj.admin.searchAuditLog({ tool_name: 'batch_create_entries', limit: 2 })

// Search by limit
const auditByLimit = await mj.admin.searchAuditLog({ limit: 1 })

return {
  auditByToolSuccess: auditByTool.success,
  auditByToolCount: auditByTool.count <= 2,
  auditByLimitSuccess: auditByLimit.success,
  auditByLimitCount: auditByLimit.count === 1 || auditByLimit.count === 0,
}
```

| Check                 | Expected |
| --------------------- | -------- |
| `auditByLimitSuccess` | `true`   |
| `auditByLimitCount`   | `true`   |

---

## Success Criteria

- Admin batch operations (`batchCreateEntries`, `batchUpdateEntries`, `batchDeleteEntries`) execute successfully via Code Mode
- Code Mode correctly resolves fallback aliases like `mj.admin.batchCreateEntries`
- `searchAuditLog` successfully queries and limits audit telemetry
