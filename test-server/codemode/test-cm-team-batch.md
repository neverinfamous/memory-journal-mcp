# Re-Test memory-journal-mcp — Code Mode: Team Batch Operations

Test team batch operations through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.4b — ~5 test cases.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
3. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
3. Provide a very brief final summary including **Total Token Estimate**.

---

## Phase 28: Team Batch via Code Mode

### 28.4b Team Batch Operations

```javascript
// Test code:
// Batch Create
const bCreated = await mj.team.teamBatchCreateEntries({
  workspace_id: "test-ws",
  entries: [
    { content: 'CM4 team batch 1' },
    { content: 'CM4 team batch 2' }
  ]
})
if (!bCreated.success) return { success: false, error: bCreated.error }
const [id1, id2] = bCreated.entryIds

// Batch Update
const bUpdated = await mj.team.teamBatchUpdateEntries({
  workspace_id: "test-ws",
  updates: [
    { entry_id: id1, content: 'CM4 team batch 1 updated' }
  ]
})

// Batch Delete
const bDeleted = await mj.team.teamBatchDeleteEntries({
  workspace_id: "test-ws",
  entry_ids: [id1, id2]
})

// Verify Aliases
const bAliasCreated = await mj.team.teamBatchCreateEntries({
  workspace_id: "test-ws",
  entries: [
    { content: 'CM4 team alias 1' }
  ]
})
await mj.team.teamBatchDeleteEntries({
  workspace_id: "test-ws",
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

---

## Success Criteria

- Team batch operations execute successfully via Code Mode and fallback aliases resolve correctly
