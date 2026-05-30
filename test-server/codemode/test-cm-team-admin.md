# Re-Test memory-journal-mcp — Code Mode: Team Admin & Collaboration

Test team administration (update, delete, merge tags), analytics, relationships, export, and backup through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.4–28.9 — ~12 test cases covering team admin, analytics, relationships, IO, and backup via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 28: Team Admin & Collaboration via Code Mode

### 28.4 Team Admin

```javascript
// Test code:
const r = await mj.team.teamGetRecent({ project_number: 1, limit: 1, project_number: 1 })
const id = r.entries[0].id

const updated = await mj.team.teamUpdateEntry({project_number: 1,  project_number: 1, entry_id: id,
  content: 'CM4 updated team content',
  tags: ['cm4-updated-team'], })
const verify = await mj.team.teamGetEntryById({project_number: 1,  project_number: 1, entry_id: id })

// Merge tags
await mj.team.teamCreateEntry({ project_number: 1, content: 'CM4 merge source', tags: ['cm4-team-old'], project_number: 1 })
const merged = await mj.team.teamMergeTags({ project_number: 1, source_tag: 'cm4-team-old',
  target_tag: 'cm4-team-new', })
const afterTags = await mj.team.teamListTags({})
const oldGone = !afterTags.tags?.some((t) => t.name === 'cm4-team-old')
const newExists = afterTags.tags?.some((t) => t.name === 'cm4-team-new')

// Soft delete
const toDelete = await mj.team.teamCreateEntry({ project_number: 1, content: 'CM4 delete me', project_number: 1 })
const deleted = await mj.team.teamDeleteEntry({project_number: 1,  project_number: 1, entry_id: toDelete.entry.id })

return {
  updateSuccess: updated.success,
  contentUpdated: verify.entry?.content === 'CM4 updated team content',
  mergeSuccess: merged.success,
  oldTagGone: oldGone,
  newTagExists: newExists,
  deleteSuccess: deleted.success,
}
```

| Check            | Expected |
| ---------------- | -------- |
| `updateSuccess`  | `true`   |
| `contentUpdated` | `true`   |
| `mergeSuccess`   | `true`   |
| `oldTagGone`     | `true`   |
| `newTagExists`   | `true`   |
| `deleteSuccess`  | `true`   |

### 28.5 Team Analytics

```javascript
// Test code:
const stats = await mj.team.teamGetStatistics({})
const monthly = await mj.team.teamGetStatistics({ group_by: 'month' })
return {
  hasTotalEntries: typeof stats.totalEntries === 'number',
  hasEntriesByType: !!stats.entriesByType,
  hasAuthors: Array.isArray(stats.authors),
  monthlyHasPeriods: Array.isArray(monthly.entriesByPeriod),
}
```

| Check               | Expected |
| ------------------- | -------- |
| `hasTotalEntries`   | `true`   |
| `hasEntriesByType`  | `true`   |
| `hasAuthors`        | `true`   |
| `monthlyHasPeriods` | `true`   |

### 28.6 Team Relationships

```javascript
// Test code:
const r = await mj.team.teamGetRecent({ project_number: 1, limit: 2, project_number: 1 })
const [a, b] = r.entries.map((e) => e.id)

const linked = await mj.team.teamLinkEntries({
  project_number: 1, from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
  description: 'CM4 team link test',
  project_number: 1,
})
const dup = await mj.team.teamLinkEntries({
  project_number: 1, from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
  project_number: 1,
})
const viz = await mj.team.teamVisualizeRelationships({ project_number: 1, entry_id: a })
const vizTag = await mj.team.teamVisualizeRelationships({ project_number: 1, tag: 'codemode4-team-test' })

return {
  linkSuccess: linked.success,
  hasDescription: !!linked.relationship?.description,
  dupDetected: dup.duplicate === true,
  hasMermaid: typeof viz.mermaid === 'string' && viz.mermaid.length > 0,
  nodeCount: viz.nodeCount,
  tagVizHasMermaid: typeof vizTag.mermaid === 'string',
}
```

| Check            | Expected |
| ---------------- | -------- |
| `linkSuccess`    | `true`   |
| `hasDescription` | `true`   |
| `dupDetected`    | `true`   |
| `hasMermaid`     | `true`   |

### 28.7 Team IO & Export

```javascript
// Test code:
const jsonExport = await mj.team.teamExportEntries({ project_number: 1, format: 'json', limit: 5 })
const mdExport = await mj.team.teamExportEntries({ project_number: 1, format: 'markdown', limit: 5 })

const MOCK_DIR = 'c:/Users/chris/Desktop/memory-journal-mcp/test-server/codemode/cm_team_export'

const ioExport = await mj.team.teamExportMarkdown({
  output_dir: MOCK_DIR,
  limit: 5,
  project_number: 1,
})

const ioImport = await mj.team.teamImportMarkdown({
  source_dir: MOCK_DIR,
  dry_run: true,
  project_number: 1,
})

return {
  jsonHasData: typeof jsonExport.data === 'string',
  mdHasData: typeof mdExport.data === 'string',
  ioExportSuccess: ioExport.success,
  ioExportedCount: ioExport.exported_count ?? 0,
  ioImportSuccess: ioImport.success,
  ioImportDryRun: ioImport.dry_run,
}
```

| Check             | Expected |
| ----------------- | -------- |
| `jsonHasData`     | `true`   |
| `mdHasData`       | `true`   |
| `ioExportSuccess` | `true`   |
| `ioImportDryRun`  | `true`   |

### 28.8 Team Backup

```javascript
// Test code:
const named = await mj.team.teamBackup({ name: 'cm4-team-backup' })
const auto = await mj.team.teamBackup({})
const list = await mj.team.teamListBackups({})
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

- `team_update_entry(project_number: 1)` updates content, tags, and entry_type
- `team_delete_entry(project_number: 1)` soft-deletes team entries
- `team_merge_tags(project_number: 1)` consolidates tags — source removed, entries re-tagged
- `team_get_statistics` returns `totalEntries`, `entriesByType`, `authors`
- `team_link_entries(project_number: 1)` creates relationships with duplicate detection
- `team_visualize_relationships(project_number: 1)` returns Mermaid diagram with node/edge counts
- `team_export_entries(project_number: 1)` exports JSON and markdown with filters
- `team_backup` creates named and auto-named backups
- `team_list_backups` returns backup metadata
- `team_get_collaboration_matrix` correctly streams analytics through Code Mode bindings
