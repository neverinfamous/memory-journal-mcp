# Team CRUD Expansion Plan

> **Status**: Planned for next release
> **Complexity**: 3/5 — Moderate scope, low risk, extends existing patterns

## Problem

The team tool group (`team.ts`) only supports 3 operations: `team_create_entry`, `team_get_recent`, and `team_search`. Entries shared to the team DB via `share_with_team` become unmanageable — no way to read by ID, update, or delete them. This makes test cleanup impossible and prevents correcting accidental shares.

## Current vs Proposed

| Capability | Current | Proposed               |
| ---------- | ------- | ---------------------- |
| Create     | ✅      | —                      |
| Get recent | ✅      | —                      |
| Search     | ✅      | —                      |
| Get by ID  | ❌      | `team_get_entry_by_id` |
| Update     | ❌      | `team_update_entry`    |
| Delete     | ❌      | `team_delete_entry`    |

All 3 new tools follow the established patterns from `team_create_entry` (author enrichment, TEAM_DB_PATH guard, batch author fetch).

---

## New Tools

### `team_get_entry_by_id`

- **Group**: `team`
- **Annotations**: `readOnlyHint: true, idempotentHint: true`
- **Input**: `{ entry_id: number, include_relationships?: boolean }`
- **Output**: `{ success, entry: { ...entry, author } }`
- **Behavior**: Fetch a single team entry by ID. Enrich with author from `memory_journal.author` column. Optionally include relationships.
- **Error paths**: Team DB not configured, entry not found.

### `team_update_entry`

- **Group**: `team`
- **Annotations**: `readOnlyHint: false, idempotentHint: true`
- **Input**: `{ entry_id: number, content?: string, tags?: string[], entry_type?: EntryType, significance_type?: SignificanceType }`
- **Output**: `{ success, entry: { ...updated, author } }`
- **Behavior**: Update content, tags, entry_type, or significance_type of an existing team entry. Mirror the personal `update_entry` logic but operate on the team DB. Preserve author.
- **Error paths**: Team DB not configured, entry not found, invalid entry_type/significance_type.

### `team_delete_entry`

- **Group**: `team`
- **Annotations**: `readOnlyHint: false, idempotentHint: true, destructiveHint: true`
- **Input**: `{ entry_id: number, permanent?: boolean }`
- **Output**: `{ success, entryId, permanent }`
- **Behavior**: Soft-delete (set `deleted_at`) by default, permanent delete when `permanent: true`. Mirrors personal `delete_entry`.
- **Error paths**: Team DB not configured, entry not found.

---

## Implementation

### Files to Modify

#### [MODIFY] [team.ts](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/handlers/tools/team.ts)

Add 3 new tool definitions following the existing pattern:

1. Input schemas (strict + relaxed MCP variants) for each new tool
2. Output schemas extending `TeamEntryOutputSchema` + `ErrorFieldsMixin`
3. Handler functions with TEAM_DB_NOT_CONFIGURED guards and `formatHandlerError` wrappers
4. Author enrichment via `batchFetchAuthors` (get/update) or direct query (delete)
5. Update file header comment: `Team Tool Group - 6 tools`

> [!NOTE]
> If `team.ts` exceeds ~500 lines after the additions, split into `team/` directory with `index.ts` barrel + sub-modules (e.g., `team/crud.ts`, `team/search.ts`).

#### [MODIFY] [server-instructions.md](file:///C:/Users/chris/Desktop/memory-journal-mcp/src/constants/server-instructions.md)

Add the 3 new tools to the Team group section with usage examples.

#### [MODIFY] [tool-reference.md](file:///C:/Users/chris/Desktop/memory-journal-mcp/docs/tool-reference.md)

Add entries for the 3 new tools.

#### [MODIFY] [code-map.md](file:///C:/Users/chris/Desktop/memory-journal-mcp/docs/code-map.md)

Update team tool count (3 → 6).

### Tests

#### [MODIFY] [test-tools-codemode2.md](file:///C:/Users/chris/Desktop/memory-journal-mcp/test-server/test-tools-codemode2.md)

Add team CRUD test scenarios via Code Mode.

#### [NEW] Unit tests

Add Vitest tests for the 3 new handlers covering success paths, error paths, and edge cases.

---

## Code Mode Bridge

The new tools automatically appear in the `mj.team.*` API bridge once registered. Expected additions:

```javascript
mj.team.getEntryById({ entry_id: 42 })
mj.team.updateEntry({ entry_id: 42, content: 'updated' })
mj.team.deleteEntry({ entry_id: 42, permanent: true })
```

Aliases to add: `mj.team.get(id)`, `mj.team.update(...)`, `mj.team.delete(...)`.

---

## Verification

1. `npm run lint && npm run typecheck && npm run build`
2. `npx vitest run` — all existing + new tests pass
3. Manual MCP test: create → get by ID → update → verify → soft delete → permanent delete
4. Code Mode test: same lifecycle via `mj.team.*` API
5. Readonly mode: `team_get_entry_by_id` accessible, update/delete blocked
