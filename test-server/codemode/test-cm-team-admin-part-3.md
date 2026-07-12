# Re-Test memory-journal-mcp — Code Mode: Team Admin & Collaboration

Test team administration (update, delete, merge tags), analytics, relationships, export, and backup through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.4–28.9 — ~12 test cases covering team admin, analytics, relationships, IO, and backup via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
   - **Clean up test artifacts:** Delete any files exported to the `cm_team_export` directory (or other mock output directories) created during testing.

---

## Phase 28: Team Admin & Collaboration via Code Mode

### 28.7 Team IO & Export

```javascript
// Test code:
const jsonExport = await mj.team.teamExportEntries({ workspace_id: "test-ws", format: 'json', limit: 5 })
const mdExport = await mj.team.teamExportEntries({
  workspace_id: "test-ws",
  format: 'markdown',
  limit: 5,
})

const MOCK_DIR = 'c:/Users/chris/Desktop/memory-journal-mcp/test-server/codemode/cm_team_export'

const ioExport = await mj.team.teamExportMarkdown({
  output_dir: MOCK_DIR,
  limit: 5,
  workspace_id: "test-ws",
})

const ioImport = await mj.team.teamImportMarkdown({
  source_dir: MOCK_DIR,
  dry_run: true,
  workspace_id: "test-ws",
})

const ioExtImport = await mj.team.teamImportExternal({
  source_dir: MOCK_DIR,
  source_format: 'obsidian',
  dry_run: true,
  workspace_id: "test-ws",
})
if (!jsonExport.success) return { success: false, error: jsonExport.error }
if (!mdExport.success) return { success: false, error: mdExport.error }

return {
  jsonHasData: typeof jsonExport.data === 'string',
  mdHasData: typeof mdExport.data === 'string',
  ioExportSuccess: ioExport.success,
  ioExportedCount: ioExport.exported_count ?? 0,
  ioImportSuccess: ioImport.success,
  ioImportDryRun: ioImport.dry_run,
  ioExtImportSuccess: ioExtImport.success,
}
```

| Check             | Expected |
| ----------------- | -------- |
| `jsonHasData`     | `true`   |
| `mdHasData`       | `true`   |
| `ioExportSuccess` | `true`   |
| `ioImportSuccess` | `true` (dry run successful) |
| `ioImportDryRun`  | `true`   |
| `ioExtImportSuccess` | `true` (dry run successful) |

### 28.8 Team Backup

```javascript
// Test code:
const named = await mj.team.teamBackup({ name: 'cm4-team-backup' })
if (!named.success) return { success: false, error: named.error }
const auto = await mj.team.teamBackup({})
if (!auto.success) return { success: false, error: auto.error }
const list = await mj.team.teamListBackups({})
if (!list.success) return { success: false, error: list.error }
return {
  namedSuccess: named.success,
  namedFilename: named.filename,
  namedHasPath: !!named.path,
  namedHasSize: typeof named.sizeBytes === 'number',
  autoSuccess: auto.success,
  listTotal: list.total,
  listHasBackups: Array.isArray(list.backups),
}
```

| Check            | Expected |
| ---------------- | -------- |
| `namedSuccess`   | `true`   |
| `namedHasPath`   | `true`   |
| `namedHasSize`   | `true`   |
| `autoSuccess`    | `true`   |
| `listHasBackups` | `true`   |

### 28.9 Team Collaboration Matrix & Analytics

```javascript
// Test code:
const matrix = await mj.team.teamGetCollaborationMatrix({})
if (!matrix.success) return { success: false, error: matrix.error }

// Return key properties to prove Code Mode boundary bindings work seamlessly
return {
  success: matrix.success,
  hasTotalAuthors: typeof matrix.totalAuthors === 'number',
  hasActivityList: Array.isArray(matrix.authorActivity),
  hasEntriesNum: typeof matrix.totalEntries === 'number',
}
```

| Check             | Expected |
| ----------------- | -------- |
| `success`         | `true`   |
| `hasTotalAuthors` | `true`   |
| `hasActivityList` | `true`   |
| `hasEntriesNum`   | `true`   |

---


## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `team_update_entry(workspace_id: "test-ws")` updates content, tags, and entry_type
- `team_update_entry(workspace_id: "test-ws")` correctly rejects stale versions via optimistic locking (`VERSION_CONFLICT`)
- `team_delete_entry(workspace_id: "test-ws")` soft-deletes team entries
- `team_merge_tags(workspace_id: "test-ws")` consolidates tags — source removed, entries re-tagged
- `team_get_statistics` returns `totalEntries`, `entriesByType`, `authors`
- `team_link_entries(workspace_id: "test-ws")` creates relationships with duplicate detection
- `team_visualize_relationships(workspace_id: "test-ws")` returns Mermaid diagram with node/edge counts
- `team_export_entries(workspace_id: "test-ws")` exports JSON and markdown with filters
- `team_backup` creates named and auto-named backups
- `team_list_backups` returns backup metadata
- `team_get_collaboration_matrix` correctly streams analytics through Code Mode bindings
- Team batch operations execute successfully via Code Mode and fallback aliases resolve correctly
- Team soft-delete recovery (`team_restore_entry`, `team_list_deleted_entries`) is functional via Code Mode scripts
- Keyset cursor pagination and archiving filters (`is_archived`) are supported on team entries via Code Mode scripts
