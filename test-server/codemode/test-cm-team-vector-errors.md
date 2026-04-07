# Test memory-journal-mcp — Code Mode: Team Vector, Insights & Cross-Tool Errors

Test team vector search, cross-project insights, and comprehensive cross-tool error path verification through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 27.9–27.10 — ~10 test cases covering team vector operations, insights, and cross-tool structured error verification via Code Mode.

**Prerequisites:**

- Phase 27.1–27.8 (Team CRUD, Admin & Collaboration) must have completed successfully.
- Seed data S15–S17 are team DB entries with `project_number: 5`, required for `team_get_cross_project_insights`.
- Confirm MCP server instructions were auto-received before starting.
- Use codemode directly for all tests — not the terminal or scripts.

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

## Phase 27 (continued): Team Vector, Insights & Cross-Tool Errors

### 27.9 Team Vector & Cross-Project Insights

```javascript
// Test code:
const rebuild = await mj.team.teamRebuildVectorIndex({})
const stats = await mj.team.teamGetVectorIndexStats({})

const recent = await mj.team.teamGetRecent({ limit: 1 })
const addResult = await mj.team.teamAddToVectorIndex({
  entry_id: recent.entries[0].id,
})
const addBad = await mj.team.teamAddToVectorIndex({ entry_id: 999999 })

const search = await mj.team.teamSemanticSearch({ query: 'standup' })
const relatedById = await mj.team.teamSemanticSearch({ entry_id: recent.entries[0].id })
const strict = await mj.team.teamSemanticSearch({
  query: 'standup',
  similarity_threshold: 0.5,
})

const insights = await mj.team.teamGetCrossProjectInsights({})
const insightsFiltered = await mj.team.teamGetCrossProjectInsights({
  start_date: '2026-01-01',
  end_date: '2026-03-01',
  min_entries: 1,
})

return {
  rebuildSuccess: rebuild.success,
  entriesIndexed: rebuild.entriesIndexed,
  vectorAvailable: stats.available,
  vectorItemCount: stats.itemCount,
  searchCount: search.entries?.length ?? 0,
  relatedCount: relatedById.entries?.length ?? 0,
  strictFewer: (strict.entries?.length ?? 0) <= (search.entries?.length ?? 0),
  addSuccess: addResult.success,
  addBadError: addBad.success === false,
  insightsProjectCount: insights.project_count,
  insightsHasProjects: Array.isArray(insights.projects),
  filteredInsights: insightsFiltered.project_count >= 0,
}
```

| Check                  | Expected                                                                  |
| ---------------------- | ------------------------------------------------------------------------- |
| `rebuildSuccess`       | `true`                                                                    |
| `entriesIndexed`       | Number > 0                                                                |
| `vectorAvailable`      | `true`                                                                    |
| `searchCount`          | ≥ 1                                                                       |
| `relatedCount`         | ≥ 1                                                                       |
| `strictFewer`          | `true`                                                                    |
| `addSuccess`           | `true`                                                                    |
| `addBadError`          | `true`                                                                    |
| `insightsHasProjects`  | `true`                                                                    |
| `insightsProjectCount` | ≥ 1 (project 5 visible with seed entries S15–S17; 0 if team seed missing) |
| `filteredInsights`     | `project_count ≥ 0` (≥ 1 if S15–S17 fall within date range)               |

### 27.10 Cross-Tool Error Path Verification (via Code Mode)

> [!IMPORTANT]
> Verify that tool errors propagate as structured handler errors through the Code Mode API bridge — not as raw MCP errors or unhandled exceptions.

```javascript
// Test code — batch error path testing (Execute with mj_execute_code repo parameter: 'memory-journal-mcp'):
const errors = {}

// Core errors
errors.createEmpty = await mj.core.createEntry({ content: '' })
errors.getNotFound = await mj.core.getEntryById({ entry_id: 999999 })
errors.updateNotFound = await mj.admin.updateEntry({ entry_id: 999999, content: 'x' })
errors.deleteNotFound = await mj.admin.deleteEntry({ entry_id: 999999 })

// Relationship errors
errors.linkBadSource = await mj.relationships.linkEntries({
  from_entry_id: 999999,
  to_entry_id: 1,
  relationship_type: 'references',
})
errors.vizNotFound = await mj.relationships.visualizeRelationships({ entry_id: 999999 })

// GitHub errors
errors.issueNotFound = await mj.github.getGithubIssue({ issue_number: 999999 })
errors.prNotFound = await mj.github.getGithubPr({ pr_number: 999999 })
errors.msNotFound = await mj.github.getGithubMilestone({ milestone_number: 999999 })

// Backup errors
errors.restoreNotFound = await mj.backup.restoreBackup({
  filename: 'nonexistent.db',
  confirm: true,
})
errors.backupTraversal = await mj.backup.backupJournal({ name: '../../../etc/passwd' })

// Admin errors
errors.mergeNonexistent = await mj.admin.mergeTags({
  source_tag: 'nonexistent-xyz-abc',
  target_tag: 'test',
})
errors.addVectorBad = await mj.admin.addToVectorIndex({ entry_id: 999999 })

// Team errors
errors.teamGetNotFound = await mj.team.teamGetEntryById({ entry_id: 999999 })
errors.teamUpdateNotFound = await mj.team.teamUpdateEntry({ entry_id: 999999, content: 'x' })
errors.teamDeleteNotFound = await mj.team.teamDeleteEntry({ entry_id: 999999 })
errors.teamLinkBad = await mj.team.teamLinkEntries({
  from_entry_id: 999999,
  to_entry_id: 1,
  relationship_type: 'references',
})

// Team vector errors (only true error paths)
errors.teamAddVectorBad = await mj.team.teamAddToVectorIndex({ entry_id: 999999 })

// Verify all errors are structured (not raw throws)
const allStructured = Object.entries(errors).every(([key, val]) => {
  return (
    val &&
    typeof val === 'object' &&
    (val.success === false || val.error !== undefined || val.message?.includes('not found'))
  )
})

return {
  testedCount: Object.keys(errors).length,
  allStructured,
  details: Object.fromEntries(
    Object.entries(errors).map(([k, v]) => [
      k,
      {
        success: v.success,
        hasError: !!v.error || !!v.message,
        errorSnippet: (v.error || v.message || '')?.substring(0, 60),
      },
    ])
  ),
}
```

| Check           | Expected                                            |
| --------------- | --------------------------------------------------- |
| `testedCount`   | 18                                                  |
| `allStructured` | `true` — no raw exceptions through Code Mode bridge |

---

## Cleanup

After testing, remove all entries and backups created during Phases 25-27:

```javascript
// Cleanup code:
const entries = await mj.search.searchEntries({ query: 'CM4', limit: 50 })
const cm4Entries = entries.entries.filter(
  (e) => e.content?.includes('CM4') || e.tags?.some((t) => t.startsWith('codemode4'))
)
const results = []
for (const e of cm4Entries) {
  const del = await mj.admin.deleteEntry({ entry_id: e.id, permanent: true })
  results.push({ id: e.id, deleted: del.success })
}

// Clean up team entries created during Phase 27
const teamEntries = await mj.team.teamSearch({ query: 'CM4', limit: 50 })
for (const e of teamEntries.entries ?? []) {
  if (e.content?.includes('CM4')) {
    const del = await mj.team.teamDeleteEntry({ entry_id: e.id })
    results.push({ id: e.id, source: 'team', deleted: del.success })
  }
}

return { cleaned: results.length, details: results }
```

---

## Success Criteria

- [ ] `team_rebuild_vector_index` indexes team entries via Code Mode
- [ ] `team_get_vector_index_stats` returns vector stats via Code Mode
- [ ] `team_semantic_search` with threshold filtering works via Code Mode
- [ ] `team_add_to_vector_index` succeeds for existing, errors for nonexistent via Code Mode
- [ ] `team_get_cross_project_insights` returns schema-compliant response via Code Mode
- [ ] All 18 cross-tool error paths return structured handler errors (not raw throws) through Code Mode
- [ ] All test entries cleaned up after Phase 27
