# Re-Test memory-journal-mcp — Code Mode: Core CRUD Advanced

Test core CRUD operations through the Code Mode mj.* API bridge (Advanced cases).

**Scope:** 1 tool (mj_execute_code), Phase 20B (Part 2) — ~9 test cases.

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

## Phase 20B: Core CRUD Advanced via Code Mode

### 20.14 Soft-Delete Recovery, Archiving & Cursor Pagination

```javascript
// Test code:
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 recovery test' })
const id = created.entry.id
await mj.admin.deleteEntry({ id: id, permanent: false })
const deletedList = await mj.search.listDeletedEntries({ workspace_id: "test-ws" })
const isDeleted = deletedList.entries?.some(e => e.id === id)
const restored = await mj.admin.restoreEntry({ id: id })
const verifyDeleted = await mj.search.listDeletedEntries({ workspace_id: "test-ws" })
const isNoLongerDeleted = !verifyDeleted.entries?.some(e => e.id === id)

const archived = await mj.admin.updateEntry({ id: id, isArchived: true })
const archivedOff = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 10, includeArchived: false })
const isArchivedHidden = !archivedOff.entries?.some(e => e.id === id)
const archivedOn = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 10, includeArchived: true })
const isArchivedVisible = archivedOn.entries?.some(e => e.id === id)

const pagPage1 = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 2 })
const hasCursor = typeof pagPage1.nextCursor === 'string'

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
  id: id,
  expectedVersion: v1,
  content: 'CM3 locking update 1'
})
const v2 = update1.entry?.version

let conflictCaught = false
const update2 = await mj.admin.updateEntry({
  id: id,
  expectedVersion: v1, // deliberately stale
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
- `create_entry` rejects invalid `type` and `significance_type` with structured errors
- `create_entry` rejects empty content with structured error
- `create_entry` with `project_owner` persists the field
- `create_entry` with `auto_context: false` creates entry without auto-generated context
- `create_entry` with `issueNumber` auto-populates `issueUrl`
- `get_entry_by_id` returns `entryType`, `content`, `tags` via Code Mode (note: `importance`/`importanceBreakdown` are available at the top level)
- `get_entry_by_id` with `include_relationships: false` omits relationship data
- `update_entry` updates content, tags, and type — verified via read-back
- `update_entry` `isPersonal` toggle correctly changes personal status
- `update_entry` correctly rejects stale versions via optimistic locking (`VERSION_CONFLICT`)
- `update_entry` returns structured error for nonexistent IDs
- `delete_entry` soft delete hides entry from search
- `delete_entry` permanent delete and nonexistent ID both return structured responses
- `get_recent_entries` with `isPersonal` filter returns correctly filtered entries
- `get_entry_history` returns multiple historical snapshots successfully via Code Mode
- `test_simple` callable via Code Mode
- `restore_entry` and `list_deleted_entries` are functional and callable via Code Mode scripts
- Keyset cursor pagination and `isArchived` status filters execute successfully via Code Mode scripts
- `mj_execute_code` outer `workspace_id` parameter automatically injects into mutation tools inside the sandbox (Sandbox Wrapper Pattern)
- `get_recent_entries` pagination exposes a correct `hasMore` convenience boolean
- `mj_execute_code` outer `auto_version: true` parameter automatically prefetches and injects `expectedVersion` for updates
- Number-based `workspace_id` parameters (`5`) auto-resolve to string safely without throwing VALIDATION_ERROR
