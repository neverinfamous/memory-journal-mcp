# Test memory-journal-mcp — Code Mode: Core CRUD

Test core CRUD operations through the Code Mode `mj.*` API bridge: create, read, update, delete with full parameters and error paths.

**Scope:** 1 tool (`mj_execute_code`), Phase 20 — ~15 test cases covering CRUD via Code Mode.

**Prerequisites:**

- Pass 1 must have completed successfully (seed data S1-S12 exists).
- Part 1 tests (Phases 16–19) should ideally be completed.
- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the user can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Read `memory://briefing` to confirm context loaded (the briefing table confirms receipt).

---

## Phase 20: Core CRUD via Code Mode

### 20.1 Create Entry — Full Parameters

```javascript
// Test code:
const entry = await mj.core.createEntry({
  content: 'CM3 full-params test entry',
  entry_type: 'technical_note',
  tags: ['codemode3-test', 'full-params'],
  pr_number: 99,
  pr_status: 'open',
  workflow_run_id: 555,
  workflow_name: 'test-ci',
  workflow_status: 'completed',
  project_number: 5,
  is_personal: false,
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

### 20.3 Create Entry — Error Paths

| Test                 | Code                                                                                   | Expected Result                                        |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Invalid entry_type   | `return await mj.core.createEntry({ content: "test", entry_type: "invalid" });`        | `{ success: false, error: "..." }` listing valid types |
| Invalid significance | `return await mj.core.createEntry({ content: "test", significance_type: "invalid" });` | `{ success: false, error: "..." }` listing valid types |
| Empty content        | `return await mj.core.createEntry({ content: "" });`                                   | `{ success: false, error: "..." }` min length error    |

### 20.4 Get Entry By ID — Details

```javascript
// Test code:
const recent = await mj.core.getRecentEntries({ limit: 1 })
const id = recent.entries[0].id
const full = await mj.core.getEntryById({ entry_id: id })
const noRels = await mj.core.getEntryById({ entry_id: id, include_relationships: false })
return {
  hasEntryType: typeof full.entry?.entryType === 'string',
  hasContent: typeof full.entry?.content === 'string',
  hasTags: Array.isArray(full.entry?.tags),
  fullRelCount: full.entry?.relationships?.length ?? 'none',
  noRelCount: noRels.entry?.relationships?.length ?? 'none',
}
```

> [!NOTE]
> The `importance` and `importanceBreakdown` fields are not included in the `getEntryById` code-mode response. Use the direct `get_entry_by_id` tool call to access these computed fields.

| Check          | Expected                                |
| -------------- | --------------------------------------- |
| `hasEntryType` | `true`                                  |
| `hasContent`   | `true`                                  |
| `hasTags`      | `true`                                  |
| `fullRelCount` | Number ≥ 0                              |
| `noRelCount`   | `"none"` or `0` (relationships omitted) |

### 20.5 Update Entry

```javascript
// Test code:
const created = await mj.core.createEntryMinimal({ content: 'CM3 update test' })
const id = created.entry.id
const updated = await mj.admin.updateEntry({
  entry_id: id,
  content: 'CM3 updated content',
  tags: ['codemode3-updated'],
  entry_type: 'bug_fix',
})
const verify = await mj.core.getEntryById({ entry_id: id })
return {
  updateSuccess: updated.success,
  newContent: verify.entry?.content,
  newType: verify.entry?.entryType,
  newTags: verify.entry?.tags,
}
```

| Check           | Expected                |
| --------------- | ----------------------- |
| `updateSuccess` | `true`                  |
| `newContent`    | `"CM3 updated content"` |
| `newType`       | `"bug_fix"`             |
| `newTags`       | `["codemode3-updated"]` |

### 20.6 Update Entry — Error Paths

| Test               | Code                                                                         | Expected Result                                       |
| ------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Nonexistent ID     | `return await mj.admin.updateEntry({ entry_id: 999999, content: "fail" });`  | `{ success: false, error: "Entry 999999 not found" }` |
| Invalid entry_type | `return await mj.admin.updateEntry({ entry_id: 1, entry_type: "invalid" });` | `{ success: false, error: "..." }`                    |

### 20.7 Delete Entry

```javascript
// Test code:
const created = await mj.core.createEntryMinimal({ content: 'CM3 delete test' })
const id = created.entry.id
const soft = await mj.admin.deleteEntry({ entry_id: id, permanent: false })
const searchAfterSoft = await mj.search.searchEntries({ query: 'CM3 delete test', limit: 5 })
const hiddenFromSearch = !searchAfterSoft.entries.some((e) => e.id === id)
const perm = await mj.admin.deleteEntry({ entry_id: id, permanent: true })
const notFound = await mj.admin.deleteEntry({ entry_id: 999999 })
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

### 20.8 Get Recent Entries — Filters

| Test               | Code                                                                                                                                                                          | Expected Result      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| is_personal: true  | `const r = await mj.core.getRecentEntries({ limit: 5, is_personal: true }); return { count: r.entries.length, allPersonal: r.entries.every(e => e.isPersonal === true) };`    | `allPersonal: true`  |
| is_personal: false | `const r = await mj.core.getRecentEntries({ limit: 5, is_personal: false }); return { count: r.entries.length, nonePersonal: r.entries.every(e => e.isPersonal === false) };` | `nonePersonal: true` |

### 20.9 test_simple via Code Mode

| Test             | Code                                                        | Expected Result                    |
| ---------------- | ----------------------------------------------------------- | ---------------------------------- |
| Positional alias | `return await mj.core.testSimple({ message: "CM3 test" });` | `{ message: "..." }` echoing input |

---

## Cleanup

After testing, remove test entries created during Phase 20:

| Cleanup Step             | Command/Action                                              |
| ------------------------ | ----------------------------------------------------------- |
| Delete full-params entry | `delete_entry(entry_id: <full_params_id>, permanent: true)` |
| Delete shared entry      | `delete_entry(entry_id: <shared_id>, permanent: true)`      |
| Delete update test entry | `delete_entry(entry_id: <update_test_id>, permanent: true)` |

---

## Success Criteria

- [ ] `create_entry` persists all optional fields (PR, workflow, project) via Code Mode
- [ ] `create_entry` with `share_with_team: true` creates entry with `sharedWithTeam` and `author`
- [ ] `create_entry` rejects invalid `entry_type` and `significance_type` with structured errors
- [ ] `create_entry` rejects empty content with structured error
- [ ] `get_entry_by_id` returns `entryType`, `content`, `tags` via Code Mode (note: `importance`/`importanceBreakdown` only available via direct tool call)
- [ ] `get_entry_by_id` with `include_relationships: false` omits relationship data
- [ ] `update_entry` updates content, tags, and entry_type — verified via read-back
- [ ] `update_entry` returns structured error for nonexistent IDs
- [ ] `delete_entry` soft delete hides entry from search
- [ ] `delete_entry` permanent delete and nonexistent ID both return structured responses
- [ ] `get_recent_entries` with `is_personal` filter returns correctly filtered entries
- [ ] `test_simple` callable via Code Mode
