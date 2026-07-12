# Re-Test memory-journal-mcp — Code Mode: Admin Core

Test tag management, configuration, staleness, and pruning operations via Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 27.1, 27.5, 27.6 — ~6 test cases.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `pnpm run check`.
3. Provide a very brief final summary including **Total Token Estimate**.

---

## Phase 27: Admin Core via Code Mode

### 27.1 Tag Management

```javascript
// Test code:
const tags = await mj.core.listTags({})
const hasEntries = tags.tags?.length > 0

// Create source tag for merge
await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'CM4 merge test entry',
  tags: ['cm4-old-tag'],
})
const merged = await mj.admin.mergeTags({
  source_tag: 'cm4-old-tag',
  target_tag: 'cm4-new-tag',
})
const afterMerge = await mj.core.listTags({})
const oldGone = !afterMerge.tags?.some((t) => t.name === 'cm4-old-tag')
const newExists = afterMerge.tags?.some((t) => t.name === 'cm4-new-tag')

// Error paths
const sameMerge = await mj.admin.mergeTags({
  source_tag: 'cm4-new-tag',
  target_tag: 'cm4-new-tag',
})
const nonexistentMerge = await mj.admin.mergeTags({
  source_tag: 'nonexistent-xyz-cm4',
  target_tag: 'test',
})

return {
  tagCount: tags.tags?.length ?? 0,
  mergeSuccess: merged.success,
  entriesUpdated: merged.entriesUpdated,
  oldTagGone: oldGone,
  newTagExists: newExists,
  sameTagError: sameMerge.success === false,
  nonexistentError: nonexistentMerge.success === false,
}
```

| Check              | Expected |
| ------------------ | -------- |
| `mergeSuccess`     | `true`   |
| `oldTagGone`       | `true`   |
| `newTagExists`     | `true`   |
| `sameTagError`     | `true`   |
| `nonexistentError` | `true`   |

### 27.5 Runtime Configuration

```javascript
// Test code:
// Change config
const configChange = await mj.admin.updateConfiguration({
  briefing_entries: 3,
  instruction_level: "essential"
})

// Revert config
const revertChange = await mj.admin.updateConfiguration({
  briefing_entries: 10,
  instruction_level: "standard"
})

return {
  configChangeSuccess: configChange.success,
  configChangeKeys: configChange.updated?.includes("briefing_entries") && configChange.updated?.includes("instruction_level"),
  revertSuccess: revertChange.success
}
```

| Check                 | Expected |
| --------------------- | -------- |
| `configChangeSuccess` | `true`   |
| `configChangeKeys`    | `true`   |
| `revertSuccess`       | `true`   |

### 27.6 Staleness & Auto Prune

```javascript
// Test code:
// markAnchorsStale
const markStale = await mj.core.markAnchorsStale({
  anchor_id: 1,
  staleness_reason: "Testing staleness marking via Code Mode"
})

// runAutoPrune
const prune = await mj.admin.runAutoPrune({
  dry_run: true
})

return {
  markStaleSuccess: markStale.success || markStale.code === "RESOURCE_NOT_FOUND",
  pruneSuccess: prune.success,
  pruneHasStats: prune.stats !== undefined
}
```

| Check                 | Expected |
| --------------------- | -------- |
| `markStaleSuccess`    | `true`   |
| `pruneSuccess`        | `true`   |
| `pruneHasStats`       | `true`   |

---

## Success Criteria

- `list_tags` returns tag list via Code Mode
- `merge_tags` consolidates tags correctly — source removed, target exists
- `merge_tags` returns structured errors for same-tag and nonexistent source
- `updateConfiguration` correctly updates server configuration via Code Mode
- `markAnchorsStale` successfully marks anchors as stale or safely ignores missing entries
- `runAutoPrune` executes dry-run successfully and returns stats
