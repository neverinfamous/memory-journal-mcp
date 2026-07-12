# Re-Test memory-journal-mcp — Code Mode: Team Batch Operations

Test team batch operations through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.4b — ~5 test cases.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `pnpm run check`.
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
