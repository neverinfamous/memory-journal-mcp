# Test memory-journal-mcp — Code Mode: Admin, Backup & Export

Test tag management, export formats/filters, and the backup/restore lifecycle through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 26 — ~10 test cases covering admin, export, and backup operations via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 27: Admin, Backup & Export via Code Mode

### 27.1 Tag Management

```javascript
// Test code:
const tags = await mj.core.listTags({})
const hasEntries = tags.tags?.length > 0

// Create source tag for merge
await mj.core.createEntry({ content: 'CM4 merge test entry', tags: ['cm4-old-tag'] })
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

### 27.2 Backup & Restore

```javascript
// Test code:
const named = await mj.backup.backupJournal({ name: 'cm4-test-backup' })
const auto = await mj.backup.backupJournal({})
const list = await mj.backup.listBackups({})

// Path traversal
const traversal = await mj.backup.backupJournal({ name: '../../etc/passwd' })

// Restore
const restored = await mj.backup.restoreBackup({
  filename: named.filename,
  confirm: true,
})

// Restore nonexistent
const badRestore = await mj.backup.restoreBackup({
  filename: 'nonexistent-cm4.db',
  confirm: true,
})

// Cleanup
const cleanup = await mj.backup.cleanupBackups({ keep_count: 5 })

return {
  namedSuccess: named.success,
  namedFilename: named.filename,
  namedHasPath: !!named.path,
  namedHasSize: typeof named.sizeBytes === 'number',
  autoSuccess: auto.success,
  listTotal: list.total,
  traversalBlocked: traversal.success === false,
  restoreSuccess: restored.success,
  restoreHasReverted: !!restored.revertedChanges,
  badRestoreError: badRestore.success === false,
  cleanupSuccess: cleanup.success,
}
```

| Check              | Expected |
| ------------------ | -------- |
| `namedSuccess`     | `true`   |
| `namedHasPath`     | `true`   |
| `namedHasSize`     | `true`   |
| `autoSuccess`      | `true`   |
| `traversalBlocked` | `true`   |
| `restoreSuccess`   | `true`   |
| `badRestoreError`  | `true`   |
| `cleanupSuccess`   | `true`   |

---

## Success Criteria

- [] `list_tags` returns tag list via Code Mode
- [] `merge_tags` consolidates tags correctly — source removed, target exists
- [] `merge_tags` returns structured errors for same-tag and nonexistent source

- [] `backup_journal` named and auto-named both succeed
- [] `backup_journal` path traversal blocked with structured error
- [] `list_backups` returns backup metadata
- [] `restore_backup` succeeds with `revertedChanges` field
- [] `restore_backup` nonexistent file returns structured error
- [] `cleanup_backups` deletes old backups
