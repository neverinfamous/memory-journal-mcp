# Re-Test memory-journal-mcp — Code Mode: Team Admin

Test team administration (update, delete, merge tags, restore) through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.4 — ~8 test cases.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `pnpm run check`.
3. Provide a very brief final summary including **Total Token Estimate**.

---

## Phase 28: Team Admin Core via Code Mode

### 28.4 Team Admin

```javascript
// Test code:
const r = await mj.team.teamGetRecent({ project_number: 5, limit: 1 })
if (!r.success) return { success: false, error: r.error }
const id = r.entries[0].id

const updated = await mj.team.teamUpdateEntry({
  project_number: 5,
  entry_id: id,
  content: 'CM4 updated team content',
  tags: ['cm4-updated-team'],
})
const verify = await mj.team.teamGetEntryById({
  project_number: 5,
  entry_id: id,
})
if (!verify.success) return { success: false, error: verify.error }
const v1 = verify.entry?.version

let conflictCaught = false
const update2 = await mj.team.teamUpdateEntry({
  project_number: 5,
  entry_id: id,
  expected_version: v1 - 1, // deliberately stale (it incremented on previous update)
  content: 'CM4 locking update 2'
})
if (!update2.success && update2.error?.includes('VERSION_CONFLICT')) {
  conflictCaught = true
}
// Merge tags
await mj.team.teamCreateEntry({
  project_number: 5,
  content: 'CM4 merge source',
  tags: ['cm4-team-old'],
})
const merged = await mj.team.teamMergeTags({
  project_number: 5,
  source_tag: 'cm4-team-old',
  target_tag: 'cm4-team-new',
})
const afterTags = await mj.team.teamListTags({})
const oldGone = !afterTags.tags?.some((t) => t.name === 'cm4-team-old')
const newExists = afterTags.tags?.some((t) => t.name === 'cm4-team-new')

// Soft delete and recovery
const toDelete = await mj.team.teamCreateEntry({
  project_number: 5,
  content: 'CM4 delete and recover me',
})
const deleted = await mj.team.teamDeleteEntry({
  project_number: 5,
  entry_id: toDelete.entry.id,
})
const deletedList = await mj.team.teamListDeletedEntries({
  project_number: 5,
})
if (!deletedList.success) return { success: false, error: deletedList.error }
const isDeleted = deletedList.entries?.some((e) => e.id === toDelete.entry.id)
const restored = await mj.team.teamRestoreEntry({
  project_number: 5,
  entry_id: toDelete.entry.id,
})
const verifyDeleted = await mj.team.teamListDeletedEntries({
  project_number: 5,
})
const isNoLongerDeleted = !verifyDeleted.entries?.some((e) => e.id === toDelete.entry.id)

// Archiving & Keyset pagination
const archived = await mj.team.teamUpdateEntry({
  project_number: 5,
  entry_id: toDelete.entry.id,
  is_archived: true,
})
const verifyArchived = await mj.team.teamGetEntryById({
  project_number: 5,
  entry_id: toDelete.entry.id,
})
const isArchived = verifyArchived.entry?.isArchived === true

// Clean up
await mj.team.teamDeleteEntry({
  project_number: 5,
  entry_id: toDelete.entry.id,
})

const pag1 = await mj.team.teamGetRecent({ project_number: 5, limit: 2 })
const hasCursor = typeof pag1.next_cursor === 'string'

return {
  updateSuccess: updated.success,
  contentUpdated: verify.entry?.content === 'CM4 updated team content',
  mergeSuccess: merged.success,
  oldTagGone: oldGone,
  newTagExists: newExists,
  deleteSuccess: deleted.success,
  isDeleted,
  restoreSuccess: restored.success,
  isNoLongerDeleted,
  isArchived,
  hasCursor,
  conflictCaught,
}
```

| Check               | Expected |
| ------------------- | -------- |
| `updateSuccess`     | `true`   |
| `contentUpdated`    | `true`   |
| `mergeSuccess`      | `true`   |
| `oldTagGone`        | `true`   |
| `newTagExists`      | `true`   |
| `deleteSuccess`     | `true`   |
| `isDeleted`         | `true`   |
| `restoreSuccess`    | `true`   |
| `isNoLongerDeleted` | `true`   |
| `isArchived`        | `true`   |
| `hasCursor`         | `true`   |
| `conflictCaught`    | `true`   |

---

## Success Criteria

- `team_update_entry(project_number: 5)` updates content, tags, and entry_type
- `team_update_entry(project_number: 5)` correctly rejects stale versions via optimistic locking (`VERSION_CONFLICT`)
- `team_delete_entry(project_number: 5)` soft-deletes team entries
- `team_merge_tags(project_number: 5)` consolidates tags — source removed, entries re-tagged
- Team soft-delete recovery (`team_restore_entry`, `team_list_deleted_entries`) is functional via Code Mode scripts
- Keyset cursor pagination and archiving filters (`is_archived`) are supported on team entries via Code Mode scripts
