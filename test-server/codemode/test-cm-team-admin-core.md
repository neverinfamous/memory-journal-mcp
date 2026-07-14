# Re-Test memory-journal-mcp — Code Mode: Team Admin

Test team administration (update, delete, merge tags, restore) through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.4 — ~8 test cases.

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

## Phase 28: Team Admin Core via Code Mode

### 28.4 Team Admin

```javascript
// Test code:
const r = await mj.team.teamGetRecent({ workspace_id: "test-ws", limit: 1 })
if (!r.success) return { success: false, error: r.error }
const id = r.entries[0].id

const updated = await mj.team.teamUpdateEntry({
  workspace_id: "test-ws",
  id: id,
  content: 'CM4 updated team content',
  tags: ['cm4-updated-team'],
})
const verify = await mj.team.teamGetEntryById({
  workspace_id: "test-ws",
  id: id,
})
if (!verify.success) return { success: false, error: verify.error }
const v1 = verify.entry?.version

let conflictCaught = false
const update2 = await mj.team.teamUpdateEntry({
  workspace_id: "test-ws",
  id: id,
  expectedVersion: v1 - 1, // deliberately stale (it incremented on previous update)
  content: 'CM4 locking update 2'
})
if (!update2.success && update2.error?.includes('VERSION_CONFLICT')) {
  conflictCaught = true
}
// Merge tags
await mj.team.teamCreateEntry({
  workspace_id: "test-ws",
  content: 'CM4 merge source',
  tags: ['cm4-team-old'],
})
const merged = await mj.team.teamMergeTags({
  workspace_id: "test-ws",
  source_tag: 'cm4-team-old',
  target_tag: 'cm4-team-new',
})
const afterTags = await mj.team.teamListTags({})
const oldGone = !afterTags.tags?.some((t) => t.name === 'cm4-team-old')
const newExists = afterTags.tags?.some((t) => t.name === 'cm4-team-new')

// Soft delete and recovery
const toDelete = await mj.team.teamCreateEntry({
  workspace_id: "test-ws",
  content: 'CM4 delete and recover me',
})
const deleted = await mj.team.teamDeleteEntry({
  workspace_id: "test-ws",
  id: toDelete.entry.id,
})
const deletedList = await mj.team.teamListDeletedEntries({
  workspace_id: "test-ws",
})
if (!deletedList.success) return { success: false, error: deletedList.error }
const isDeleted = deletedList.entries?.some((e) => e.id === toDelete.entry.id)
const restored = await mj.team.teamRestoreEntry({
  workspace_id: "test-ws",
  id: toDelete.entry.id,
})
const verifyDeleted = await mj.team.teamListDeletedEntries({
  workspace_id: "test-ws",
})
const isNoLongerDeleted = !verifyDeleted.entries?.some((e) => e.id === toDelete.entry.id)

// Archiving & Keyset pagination
const archived = await mj.team.teamUpdateEntry({
  workspace_id: "test-ws",
  id: toDelete.entry.id,
  isArchived: true,
})
const verifyArchived = await mj.team.teamGetEntryById({
  workspace_id: "test-ws",
  id: toDelete.entry.id,
})
const isArchived = verifyArchived.entry?.isArchived === true

// Clean up
await mj.team.teamDeleteEntry({
  workspace_id: "test-ws",
  id: toDelete.entry.id,
})

const pag1 = await mj.team.teamGetRecent({ workspace_id: "test-ws", limit: 2 })
const hasCursor = typeof pag1.nextCursor === 'string'

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

- `team_update_entry(workspace_id: "test-ws")` updates content, tags, and type
- `team_update_entry(workspace_id: "test-ws")` correctly rejects stale versions via optimistic locking (`VERSION_CONFLICT`)
- `team_delete_entry(workspace_id: "test-ws")` soft-deletes team entries
- `team_merge_tags(workspace_id: "test-ws")` consolidates tags — source removed, entries re-tagged
- Team soft-delete recovery (`team_restore_entry`, `team_list_deleted_entries`) is functional via Code Mode scripts
- Keyset cursor pagination and archiving filters (`isArchived`) are supported on team entries via Code Mode scripts
