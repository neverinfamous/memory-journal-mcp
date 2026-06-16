# Re-Test memory-journal-mcp — Code Mode: Team Flags Advanced (Hush Protocol)

Test the advanced Hush Protocol flag features (`team_list_flags`, `team_update_flag`, `team_get_flag_analytics`) and flag resources through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.13 — ~14 test cases covering idempotency, querying/filtering, metadata mutation, reopen, analytics, resource verification, and error paths via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- **CRITICAL:** This test file depends on flags generated in `test-cm-team-flags-core.md` (Phases 28.12–28.14). Do not run this file until the core file has been run and completed successfully.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify.
3. **Cleanup:** Ensure all testing artifacts/flags generated during this pass are fully cleaned up (permanently hard-deleted if necessary) so they do not persist in the user's Briefing.
4. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 28: Team Flag Advanced Tools via Code Mode

### 28.15 Flag Search & List (team_list_flags)

```javascript
// Test code:

// Search flags by tag (legacy approach — still works)
const tagSearch = await mj.team.teamSearch({ project_number: 5, tags: ['flag:blocker'] })

// Search flags by entry_type (legacy)
const typeSearch = await mj.team.teamSearchByDateRange({
  project_number: 5,
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  entry_type: 'flag',
})

// New: team_list_flags — default (active only)
const activeOnly = await mj.team.teamListFlags({ project_number: 5 })

// New: team_list_flags — all statuses
const allFlags = await mj.team.teamListFlags({ project_number: 5, status: 'all' })

// New: team_list_flags — resolved only
const resolvedOnly = await mj.team.teamListFlags({ project_number: 5, status: 'resolved' })

// New: team_list_flags — filter by flag_type
const blockersOnly = await mj.team.teamListFlags({
  project_number: 5,
  status: 'all',
  flag_type: 'blocker',
})

// New: team_list_flags — filter by target_user (with @ prefix — should be stripped)
const sarahFlags = await mj.team.teamListFlags({
  project_number: 5,
  status: 'all',
  target_user: '@sarah',
})

// New: team_list_flags — sort by priority (blockers before fyi)
const prioritySorted = await mj.team.teamListFlags({
  project_number: 5,
  status: 'all',
  sort_by: 'priority',
})

// New: team_list_flags — sort by timestamp
const timeSorted = await mj.team.teamListFlags({
  project_number: 5,
  status: 'all',
  sort_by: 'timestamp',
})

// Omit project_number on teamListFlags to test fallback / validation
const omitListFlags = await mj.team.teamListFlags({ status: 'active' })

// Verify enriched flag object shape
const firstFlag = activeOnly.flags?.[0] || allFlags.flags?.[0] || null

const result = {
  tagSearchCount: tagSearch.entries?.length ?? 0,
  typeSearchCount: typeSearch.entries?.length ?? 0,
  typeSearchAllFlags: typeSearch.entries?.every((e) => e.entryType === 'flag') ?? true,
  activeOnlySuccess: activeOnly.success,
  activeOnlyCount: activeOnly.count ?? 0,
  activeOnlyAllUnresolved: activeOnly.flags?.every((f) => f.resolved === false) ?? true,
  allFlagsCount: allFlags.count ?? 0,
  allFlagsHasActive: allFlags.active_count >= 0,
  allFlagsHasResolved: allFlags.resolved_count >= 0,
  resolvedOnlyAllResolved: resolvedOnly.flags?.every((f) => f.resolved === true) ?? true,
  blockersOnlyAllBlocker: blockersOnly.flags?.every((f) => f.flag_type === 'blocker') ?? true,
  sarahFlagsAllSarah: sarahFlags.flags?.every((f) => f.target_user === 'sarah') ?? true,
  prioritySortFirstType: prioritySorted.flags?.[0]?.flag_type,
  omitListFlagsValid: omitListFlags.success === true || (omitListFlags.success === false && omitListFlags.code === 'VALIDATION_ERROR'),
  hasEnrichedShape:
    firstFlag !== null &&
    'age_hours' in firstFlag &&
    'is_stale' in firstFlag &&
    'flag_type' in firstFlag,
  hasCountSummary:
    typeof allFlags.active_count === 'number' && typeof allFlags.resolved_count === 'number',
}
return result
```

| Check                     | Expected                                 |
| ------------------------- | ---------------------------------------- |
| `tagSearchCount`          | ≥ 1                                      |
| `typeSearchCount`         | ≥ 1                                      |
| `typeSearchAllFlags`      | `true` (filter enforced)                 |
| `activeOnlySuccess`       | `true`                                   |
| `activeOnlyCount`         | ≥ 1 (flags from 28.12 still active)      |
| `activeOnlyAllUnresolved` | `true` (default status=active)           |
| `allFlagsCount`           | ≥ 4 (includes active + resolved)         |
| `allFlagsHasActive`       | `true`                                   |
| `allFlagsHasResolved`     | `true`                                   |
| `resolvedOnlyAllResolved` | `true` (only resolved flags)             |
| `blockersOnlyAllBlocker`  | `true` (type filter works)               |
| `sarahFlagsAllSarah`      | `true` (target filter works, @ stripped) |
| `prioritySortFirstType`   | `"blocker"` (highest priority)           |
| `omitListFlagsValid`      | `true` (falls back or errors gracefully) |
| `hasEnrichedShape`        | `true` (parsed FlagContext inline)       |
| `hasCountSummary`         | `true` (active_count and resolved_count) |


### 28.16 Flag Update & Metadata Mutation (team_update_flag)

```javascript
// Test code:

// Get an active flag to update (from 28.12 — the fyi flag)
const activeFyi = await mj.team.teamListFlags({
  project_number: 5,
  status: 'active',
  flag_type: 'fyi',
})
const fyiId = activeFyi.flags?.[0]?.id
if (!fyiId) return { error: 'No active fyi flag found for update tests' }

// Escalate: fyi -> blocker
const escalated = await mj.team.teamUpdateFlag({
  flag_id: fyiId,
  flag_type: 'blocker',
})

// Reassign target_user
const reassigned = await mj.team.teamUpdateFlag({
  flag_id: fyiId,
  target_user: '@chris',
})

// Add link
const linked = await mj.team.teamUpdateFlag({
  flag_id: fyiId,
  link: 'https://github.com/example/issue/99',
})

// Edit message
const edited = await mj.team.teamUpdateFlag({
  flag_id: fyiId,
  message: 'Escalated: linting rule now blocking CI pipeline',
})

// Clear target_user (set null)
const cleared = await mj.team.teamUpdateFlag({
  flag_id: fyiId,
  target_user: null,
})

// No-op update (no changes)
const noop = await mj.team.teamUpdateFlag({ flag_id: fyiId })

// Verify final state
const final = await mj.team.teamGetEntryById({ project_number: 5, entry_id: fyiId })
const finalCtx = final.entry?.flagMetadata || null

// Error paths
const updateGhost = await mj.team.teamUpdateFlag({ flag_id: 999999 })
const updateBadVocab = await mj.team.teamUpdateFlag({ flag_id: fyiId, flag_type: 'urgent' })

// Update a non-flag entry
const recent = await mj.team.teamGetRecent({ project_number: 5, limit: 10 })
const nonFlag = recent.entries?.find((e) => e.entryType !== 'flag')
let updateNonFlag = { skipped: true }
if (nonFlag) {
  updateNonFlag = await mj.team.teamUpdateFlag({ flag_id: nonFlag.id })
}

const result = {
  escalateSuccess: escalated.success,
  escalateType: escalated.flag_type,
  escalateChanges: escalated.changes,
  reassignSuccess: reassigned.success,
  reassignChanges: reassigned.changes,
  linkedSuccess: linked.success,
  linkedChanges: linked.changes,
  editedSuccess: edited.success,
  editedChanges: edited.changes,
  clearedSuccess: cleared.success,
  clearedChanges: cleared.changes,
  noopSuccess: noop.success,
  noopChanges: noop.changes?.length ?? -1,
  finalFlagType: finalCtx?.flag_type,
  finalTarget: finalCtx?.target_user ?? 'cleared',
  finalLink: finalCtx?.link,
  updateGhostError: updateGhost.success === false,
  updateGhostCode: updateGhost.code,
  updateBadVocabError: updateBadVocab.success === false,
  updateBadVocabCode: updateBadVocab.code,
  updateNonFlagError: updateNonFlag.success === false || updateNonFlag.skipped === true,
}
return result
```

| Check                 | Expected                                      |
| --------------------- | --------------------------------------------- |
| `escalateSuccess`     | `true`                                        |
| `escalateType`        | `"blocker"`                                   |
| `escalateChanges`     | array containing `"flag_type: fyi → blocker"` |
| `reassignSuccess`     | `true`                                        |
| `reassignChanges`     | array containing target_user change           |
| `linkedSuccess`       | `true`                                        |
| `linkedChanges`       | array containing `"link: updated"`            |
| `editedSuccess`       | `true`                                        |
| `editedChanges`       | array containing `"message: updated"`         |
| `clearedSuccess`      | `true`                                        |
| `clearedChanges`      | array containing target_user cleared          |
| `noopSuccess`         | `true`                                        |
| `noopChanges`         | `0` (no changes made)                         |
| `finalFlagType`       | `"blocker"` (escalated)                       |
| `finalTarget`         | `"cleared"` (null after clear)                |
| `finalLink`           | `"https://github.com/example/issue/99"`       |
| `updateGhostError`    | `true` (not found)                            |
| `updateGhostCode`     | `"RESOURCE_NOT_FOUND"`                        |
| `updateBadVocabError` | `true` (invalid vocabulary)                   |
| `updateBadVocabCode`  | `"VALIDATION_ERROR"`                          |
| `updateNonFlagError`  | `true` (not a flag entry)                     |

### 28.17 Flag Reopen Lifecycle (team_update_flag reopen)

```javascript
// Test code:

// Create and resolve a flag
const flag = await mj.team.passTeamFlag({
  project_number: 5,
  flag_type: 'needs_review',
  message: 'CM reopen lifecycle test flag',
})
const flagId = flag.entry?.id

await mj.team.resolveTeamFlag({
  flag_id: flagId,
  resolution: 'Reviewed and approved',
})

// Verify it's resolved
const afterResolve = await mj.team.teamListFlags({
  project_number: 5,
  status: 'resolved',
})
const isResolved = afterResolve.flags?.some((f) => f.id === flagId) ?? false

// Reopen it
const reopened = await mj.team.teamUpdateFlag({
  flag_id: flagId,
  reopen: true,
})

// Verify it's active again
const afterReopen = await mj.team.teamListFlags({
  project_number: 5,
  status: 'active',
})
const isActive = afterReopen.flags?.some((f) => f.id === flagId) ?? false

// Verify resolved_at and resolution are cleared
const detail = await mj.team.teamGetEntryById({ project_number: 5, entry_id: flagId })
const ctx = detail.entry?.flagMetadata || null

// Reopen a flag that's already active (should be no-op for reopen)
const reopenActive = await mj.team.teamUpdateFlag({
  flag_id: flagId,
  reopen: true,
})

const result = {
  isResolved,
  reopenSuccess: reopened.success,
  reopenChanges: reopened.changes,
  reopenResolved: reopened.resolved,
  isActive,
  ctxResolved: ctx?.resolved,
  ctxResolvedAt: ctx?.resolved_at,
  ctxResolution: ctx?.resolution,
  contentNoMarker: !detail.entry?.content?.includes('[RESOLVED'),
  reopenActiveNoChange: reopenActive.changes?.includes('reopened') === false,
}
return result
```

| Check                  | Expected                           |
| ---------------------- | ---------------------------------- |
| `isResolved`           | `true` (flag in resolved list)     |
| `reopenSuccess`        | `true`                             |
| `reopenChanges`        | array containing `"reopened"`      |
| `reopenResolved`       | `false` (now active)               |
| `isActive`             | `true` (flag in active list)       |
| `ctxResolved`          | `false`                            |
| `ctxResolvedAt`        | `null` (cleared)                   |
| `ctxResolution`        | `null` (cleared)                   |
| `contentNoMarker`      | `true` ([RESOLVED] removed)        |
| `reopenActiveNoChange` | `true` (no-op when already active) |

### 28.18 Flag Analytics (team_get_flag_analytics)

```javascript
// Test code:

// Get analytics
const analytics = await mj.team.teamGetFlagAnalytics({ project_number: 5 })

const result = {
  analyticsSuccess: analytics.success,
  hasSummary: !!analytics.summary,
  hasByType: !!analytics.by_type,
  hasByTarget: !!analytics.by_target,
  hasTrend: !!analytics.trend,
  totalFlags: typeof analytics.summary?.total_flags === 'number',
  activeFlags: typeof analytics.summary?.active_flags === 'number',
  resolvedFlags: typeof analytics.summary?.resolved_flags === 'number',
  mathChecksOut: analytics.summary?.total_flags === ((analytics.summary?.active_flags || 0) + (analytics.summary?.resolved_flags || 0))
}
return result
```

| Check               | Expected                               |
| ------------------- | -------------------------------------- |
| `analyticsSuccess`  | `true`                                 |
| `hasSummary`        | `true`                                 |
| `hasByType`         | `true`                                 |
| `hasByTarget`       | `true`                                 |
| `hasTrend`          | `true`                                 |
| `totalFlags`        | `true` (is number)                     |
| `activeFlags`       | `true` (is number)                     |
| `resolvedFlags`     | `true` (is number)                     |
| `mathChecksOut`     | `true` (total === active + resolved)   |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `team_list_flags` defaults to `status: "active"` (only unresolved flags)
- Filtering by `status`, `flag_type`, `target_user` works correctly
- `target_user` filter strips `@` prefix for matching
- `sort_by: "priority"` returns blockers before fyi
- Response includes enriched flag objects with `age_hours`, `is_stale`, parsed metadata
- Response includes `active_count` and `resolved_count` summary
- `team_update_flag` escalates flag_type with vocabulary validation
- `team_update_flag` reassigns target_user (with `@` stripping)
- `team_update_flag` adds/updates link
- `team_update_flag` edits message and regenerates content
- `team_update_flag` clears target_user when set to `null`
- No-op update returns success with empty `changes` array
- `team_update_flag({ reopen: true })` transitions resolved → active, clears `resolved_at` and `resolution`
- Reopen on an already-active flag is a no-op
- Update on non-flag entry returns `VALIDATION_ERROR`
- Update on nonexistent entry returns `RESOURCE_NOT_FOUND`
- Update with invalid vocabulary returns `VALIDATION_ERROR`
- `team_get_flag_analytics` returns `summary` with total/active/resolved counts
- `summary` includes `avg_resolution_hours`, `median_resolution_hours`, `stale_count`
- `by_type` breaks down by flag type with `total`, `active`, `avg_resolution_hours`
- `by_target` lists users with `received` and `active` counts
- `trend` compares `current_period` vs `previous_period` with `change_pct`
- `total_flags === active_flags + resolved_flags`
- `memory://flags` returns `activeFlags` array
- `memory://flags/vocabulary` returns vocabulary with count and isDefault
- `memory://flags/history` returns `resolved_flags` array with `count`, `avg_resolution_hours`, `window_days: 7`
- All test entries cleaned up after testing
