# Test memory-journal-mcp — Code Mode: Team Admin & Collaboration

Test team administration (update, delete, merge tags), analytics, relationships, export, and backup through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 27.4–27.8 — ~12 test cases covering team admin, analytics, relationships, export, and backup via Code Mode.

**Prerequisites:**

- Phase 27.1–27.3 (Team CRUD & Search) must have completed successfully.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. Use `code-map.md` as a source of truth.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the user can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   * **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Read `memory://briefing` to confirm context loaded (the briefing table confirms receipt).

---

## Phase 27 (continued): Team Admin & Collaboration via Code Mode

### 27.4 Team Admin

```javascript
// Test code:
const r = await mj.team.teamGetRecent({ limit: 1 })
const id = r.entries[0].id

const updated = await mj.team.teamUpdateEntry({
  entry_id: id,
  content: 'CM4 updated team content',
  tags: ['cm4-updated-team'],
})
const verify = await mj.team.teamGetEntryById({ entry_id: id })

// Merge tags
await mj.team.teamCreateEntry({ content: 'CM4 merge source', tags: ['cm4-team-old'] })
const merged = await mj.team.teamMergeTags({
  source_tag: 'cm4-team-old',
  target_tag: 'cm4-team-new',
})
const afterTags = await mj.team.teamListTags({})
const oldGone = !afterTags.tags?.some((t) => t.name === 'cm4-team-old')
const newExists = afterTags.tags?.some((t) => t.name === 'cm4-team-new')

// Soft delete
const toDelete = await mj.team.teamCreateEntry({ content: 'CM4 delete me' })
const deleted = await mj.team.teamDeleteEntry({ entry_id: toDelete.entry.id })

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

### 27.5 Team Analytics

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

### 27.6 Team Relationships

```javascript
// Test code:
const r = await mj.team.teamGetRecent({ limit: 2 })
const [a, b] = r.entries.map((e) => e.id)

const linked = await mj.team.teamLinkEntries({
  from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
  description: 'CM4 team link test',
})
const dup = await mj.team.teamLinkEntries({
  from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
})
const viz = await mj.team.teamVisualizeRelationships({ entry_id: a })
const vizTag = await mj.team.teamVisualizeRelationships({ tag: 'codemode4-team-test' })

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

### 27.7 Team Export

```javascript
// Test code:
const jsonExport = await mj.team.teamExportEntries({ format: 'json', limit: 5 })
const mdExport = await mj.team.teamExportEntries({ format: 'markdown', limit: 5 })
const tagExport = await mj.team.teamExportEntries({
  format: 'json',
  tags: ['codemode4-team-test'],
  limit: 10,
})
return {
  jsonHasData: typeof jsonExport.data === 'string',
  jsonCount: jsonExport.count ?? 0,
  mdHasData: typeof mdExport.data === 'string',
  tagFilteredCount: tagExport.count ?? 0,
}
```

| Check         | Expected |
| ------------- | -------- |
| `jsonHasData` | `true`   |
| `mdHasData`   | `true`   |
| `jsonCount`   | ≥ 1      |

### 27.8 Team Backup

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

---

## Success Criteria

- [ ] `team_update_entry` updates content, tags, and entry_type
- [ ] `team_delete_entry` soft-deletes team entries
- [ ] `team_merge_tags` consolidates tags — source removed, entries re-tagged
- [ ] `team_get_statistics` returns `totalEntries`, `entriesByType`, `authors`
- [ ] `team_link_entries` creates relationships with duplicate detection
- [ ] `team_visualize_relationships` returns Mermaid diagram with node/edge counts
- [ ] `team_export_entries` exports JSON and markdown with filters
- [ ] `team_backup` creates named and auto-named backups
- [ ] `team_list_backups` returns backup metadata
