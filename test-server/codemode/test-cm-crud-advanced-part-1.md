# Re-Test memory-journal-mcp — Code Mode: Core CRUD Advanced

Test core CRUD operations through the Code Mode mj.* API bridge (Advanced cases).

**Scope:** 1 tool (mj_execute_code), Phase 20B — ~9 test cases.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use code-map.md as a source of truth.
3. If you made code changes/fixes, update UNRELEASED.md and commit.
4. Re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

---

## Phase 20B: Core CRUD Advanced via Code Mode

### 20.11 Update Entry — is_personal Toggle

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 personal toggle test' })
const id = created.entry.id

// Toggle to non-personal
const toggled = await mj.admin.updateEntry({ entry_id: id, is_personal: false })
const verify1 = await mj.core.getEntryById({ entry_id: id })

// Toggle back to personal
const toggledBack = await mj.admin.updateEntry({ entry_id: id, is_personal: true })
const verify2 = await mj.core.getEntryById({ entry_id: id })

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
| issueUrl auto-populated | `const ctx = await mj.github.getGithubContext({}); const r = await mj.core.createEntry({ workspace_id: "test-ws", content: "CM3 issue link", issue_number: 1 }); return { success: r.success, issueUrl: r.entry?.issueUrl };` | `success: true`, `issueUrl` contains github URL or is auto-populated |

### 20.13 Get Entry History

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 history test v1' })
const id = created.entry.id

await mj.admin.updateEntry({ entry_id: id, content: 'CM3 history test v2' })
await mj.admin.updateEntry({ entry_id: id, content: 'CM3 history test v3' })

const history = await mj.core.getEntryHistory({ entry_id: id })

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

### 20.14 Soft-Delete Recovery, Archiving & Cursor Pagination

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 recovery test' })
const id = created.entry.id
await mj.admin.deleteEntry({ entry_id: id, permanent: false })
const deletedList = await mj.search.listDeletedEntries({ workspace_id: "test-ws" })
const isDeleted = deletedList.entries?.some(e => e.id === id)
const restored = await mj.admin.restoreEntry({ entry_id: id })
const verifyDeleted = await mj.search.listDeletedEntries({ workspace_id: "test-ws" })
const isNoLongerDeleted = !verifyDeleted.entries?.some(e => e.id === id)

const archived = await mj.admin.updateEntry({ entry_id: id, is_archived: true })
const archivedOff = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 10, include_archived: false })
const isArchivedHidden = !archivedOff.entries?.some(e => e.id === id)
const archivedOn = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 10, include_archived: true })
const isArchivedVisible = archivedOn.entries?.some(e => e.id === id)

const pagPage1 = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 2 })
const hasCursor = typeof pagPage1.next_cursor === 'string'

return {
  isDeleted,
  restoreSuccess: restored.success,
  isNoLongerDeleted,
  isArchivedHidden,
  isArchivedVisible,
  hasCursor,
}
```

| Check               | Expected |
| ------------------- | -------- |
| `isDeleted`         | `true`   |
| `restoreSuccess`    | `true`   |
| `isNoLongerDeleted` | `true`   |
| `isArchivedHidden`  | `true`   |
| `isArchivedVisible` | `true`   |
| `hasCursor`         | `true`   |

### 20.15 Update Entry — Optimistic Locking

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 locking test' })
const id = created.entry.id
const v1 = created.entry.version

const update1 = await mj.admin.updateEntry({
  entry_id: id,
  expected_version: v1,
  content: 'CM3 locking update 1'
})
const v2 = update1.entry?.version

let conflictCaught = false
const update2 = await mj.admin.updateEntry({
  entry_id: id,
  expected_version: v1, // deliberately stale
  content: 'CM3 locking update 2'
})
if (!update2.success && update2.error?.includes('VERSION_CONFLICT')) {
  conflictCaught = true
}

return {
  firstUpdateSuccess: update1.success,
  versionIncremented: v2 > v1,
  conflictCaught
}
```

| Check                | Expected |
| -------------------- | -------- |
| `firstUpdateSuccess` | `true`   |
| `versionIncremented` | `true`   |
| `conflictCaught`     | `true`   |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `create_entry` persists all optional fields (PR, workflow, project) via Code Mode
- `create_entry` with `share_with_team: true` creates entry with `sharedWithTeam` and `author`
- `create_entry` rejects invalid `entry_type` and `significance_type` with structured errors
- `create_entry` rejects empty content with structured error
- `create_entry` with `project_owner` persists the field
- `create_entry` with `auto_context: false` creates entry without auto-generated context
- `create_entry` with `issue_number` auto-populates `issueUrl`
- `get_entry_by_id` returns `entryType`, `content`, `tags` via Code Mode (note: `importance`/`importanceBreakdown` are available at the top level)
- `get_entry_by_id` with `include_relationships: false` omits relationship data
- `update_entry` updates content, tags, and entry_type — verified via read-back
- `update_entry` `is_personal` toggle correctly changes personal status
- `update_entry` correctly rejects stale versions via optimistic locking (`VERSION_CONFLICT`)
- `update_entry` returns structured error for nonexistent IDs
- `delete_entry` soft delete hides entry from search
- `delete_entry` permanent delete and nonexistent ID both return structured responses
- `get_recent_entries` with `is_personal` filter returns correctly filtered entries
- `get_entry_history` returns multiple historical snapshots successfully via Code Mode
- `test_simple` callable via Code Mode
- `restore_entry` and `list_deleted_entries` are functional and callable via Code Mode scripts
- Keyset cursor pagination and `is_archived` status filters execute successfully via Code Mode scripts
- `mj_execute_code` outer `workspace_id` parameter automatically injects into mutation tools inside the sandbox (Sandbox Wrapper Pattern)
- `get_recent_entries` pagination exposes a correct `hasMore` convenience boolean
- `mj_execute_code` outer `auto_version: true` parameter automatically prefetches and injects `expected_version` for updates
- Number-based `workspace_id` parameters (`5`) auto-resolve to string safely without throwing VALIDATION_ERROR
