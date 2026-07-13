# Re-Test memory-journal-mcp — Code Mode: Core CRUD

Test core CRUD operations through the Code Mode `mj.*` API bridge: create, read, update, delete with full parameters and error paths.

**Scope:** 1 tool (`mj_execute_code`), Phase 20 (Part 2) — ~15 test cases covering CRUD via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 20: Core CRUD via Code Mode

### 20.4 Get Entry By ID — Details

```javascript
// Test code:
const recent = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 1 })
const id = recent.entries[0].id
const full = await mj.core.getEntryById({ entry_id: id })
const noRels = await mj.core.getEntryById({ entry_id: id, include_relationships: false })
return {
  hasEntryType: typeof full.entry?.entryType === 'string',
  hasContent: typeof full.entry?.content === 'string',
  hasTags: Array.isArray(full.entry?.tags),
  fullRelCount: full.relationships?.length ?? 'none',
  noRelCount: noRels.relationships?.length ?? 'none',
}
```

> [!NOTE]
> The `importance`, `importanceBreakdown`, and `relationships` fields are returned at the top level of the `getEntryById` code-mode response, parallel to the `entry` object itself.

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
const created = await mj.core.createEntry({ workspace_id: "test-ws",  content: 'CM3 update test' })
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
- `test_error_handling` returns structured errors via Code Mode
- `trigger_progress` returns success via Code Mode
- `restore_entry` and `list_deleted_entries` are functional and callable via Code Mode scripts
- Keyset cursor pagination and `is_archived` status filters execute successfully via Code Mode scripts
- `mj_execute_code` outer `workspace_id` parameter automatically injects into mutation tools inside the sandbox (Sandbox Wrapper Pattern)
- `get_recent_entries` pagination exposes a correct `hasMore` convenience boolean
- `mj_execute_code` outer `auto_version: true` parameter automatically prefetches and injects `expected_version` for updates
- Number-based `workspace_id` parameters (`5`) auto-resolve to string safely without throwing VALIDATION_ERROR
