# Re-Test memory-journal-mcp — Code Mode: Team Flags (Hush Protocol)

Test the Hush Protocol flag system (`team_pass_flag(project_number: 5)`, `team_resolve_flag(project_number: 5)`, `team_list_flags(project_number: 5)`, `team_update_flag`, `team_get_flag_analytics(project_number: 5)`) and flag resources through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.12–28.19 — ~24 test cases covering flag creation, vocabulary validation, resolution lifecycle, idempotency, querying/filtering, metadata mutation, reopen, analytics, resource verification, and error paths via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. **Cleanup:** Ensure all testing artifacts/flags generated during this pass are fully cleaned up (permanently hard-deleted if necessary) so they do not persist in the user's Briefing.
6. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 28: Team Flag Tools via Code Mode

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured. Flag tools use the `mj.team.passTeamFlag()`, `mj.team.resolveTeamFlag()`, `mj.team.teamListFlags()`, `mj.team.teamUpdateFlag()`, and `mj.team.teamGetFlagAnalytics()` API.
>
> **Flags are team entries with `entry_type: 'flag'`** and structured `auto_context` JSON containing flag metadata.

### 28.12 Flag Creation & Vocabulary

```javascript
// Test code:
const blocker = await mj.team.passTeamFlag({
  project_number: 5, flag_type: 'blocker',
  message: 'FK constraint prevents migration from running',
  target_user: '@sarah',
  link: 'src/database/migrations/005.ts',
  project_number: 5,
})
const fyi = await mj.team.passTeamFlag({
  project_number: 5, flag_type: 'fyi',
  message: 'New linting rule added for strict-boolean-expressions',
  project_number: 5,
})
const review = await mj.team.passTeamFlag({
  project_number: 5, flag_type: 'needs_review',
  message: 'Authentication refactor ready for review',
  target_user: 'chris',
  issue_number: 42,
  project_number: 5,
})
const help = await mj.team.passTeamFlag({
  project_number: 5, flag_type: 'help_requested',
  message: 'Cannot reproduce the race condition on Windows',
  project_number: 5,
})

// Verify entry structure
const detail = await mj.team.teamGetEntryById({project_number: 5,  project_number: 5, entry_id: blocker.entry?.id })
const flagMeta = detail.entry?.flagMetadata || null

const result = {
  blockerSuccess: blocker.success,
  blockerFlagType: blocker.flag_type,
  blockerTarget: blocker.target_user,
  blockerResolved: blocker.resolved,
  blockerHasAuthor: typeof blocker.author === 'string',
  fyiSuccess: fyi.success,
  reviewSuccess: review.success,
  helpSuccess: help.success,
  entryType: detail.entry?.entryType,
  hasTags: detail.entry?.tags?.includes('flag:blocker'),
  hasTargetTag: detail.entry?.tags?.includes('@sarah'),
  autoCtxFlagType: flagMeta?.flag_type,
  autoCtxTarget: flagMeta?.target_user,
  autoCtxLink: flagMeta?.link,
  autoCtxResolved: flagMeta?.resolved,
}
return result
```

| Check              | Expected                           |
| ------------------ | ---------------------------------- |
| `blockerSuccess`   | `true`                             |
| `blockerFlagType`  | `"blocker"`                        |
| `blockerTarget`    | `"sarah"` (@ prefix stripped)      |
| `blockerResolved`  | `false`                            |
| `blockerHasAuthor` | `true`                             |
| `fyiSuccess`       | `true`                             |
| `reviewSuccess`    | `true`                             |
| `helpSuccess`      | `true`                             |
| `entryType`        | `"flag"`                           |
| `hasTags`          | `true`                             |
| `hasTargetTag`     | `true`                             |
| `autoCtxFlagType`  | `"blocker"`                        |
| `autoCtxTarget`    | `"sarah"`                          |
| `autoCtxLink`      | `"src/database/migrations/005.ts"` |
| `autoCtxResolved`  | `false`                            |

### 28.13 Vocabulary Validation & Error Paths

```javascript
// Test code:

// Invalid vocabulary term
const badType = await mj.team.passTeamFlag({
  project_number: 5, flag_type: 'urgent',
  message: 'This should fail vocabulary check',
  project_number: 5,
})

// Missing required fields
const noType = await mj.team.passTeamFlag({ project_number: 5, message: 'no type', project_number: 5 })
const noMessage = await mj.team.passTeamFlag({ project_number: 5, flag_type: 'blocker', project_number: 5 })
const empty = await mj.team.passTeamFlag({project_number: 5,  project_number: 5 })

// Resolve nonexistent flag
const resolveGhost = await mj.team.resolveTeamFlag({ flag_id: 999999 })

// Resolve empty params
const resolveEmpty = await mj.team.resolveTeamFlag({})

// Resolve a non-flag entry (get a recent non-flag entry first)
const recent = await mj.team.teamGetRecent({project_number: 5,  project_number: 5, limit: 10 })
const nonFlagEntry = recent.entries?.find((e) => e.entryType !== 'flag')
let resolveWrongType = { skipped: true }
if (nonFlagEntry) {
  resolveWrongType = await mj.team.resolveTeamFlag({ flag_id: nonFlagEntry.id })
}

const result = {
  badTypeError: badType.success === false,
  badTypeCode: badType.code,
  badTypeHasSuggestion: typeof badType.suggestion === 'string',
  noTypeError: noType.success === false,
  noMessageError: noMessage.success === false,
  emptyError: empty.success === false,
  resolveGhostError: resolveGhost.success === false,
  resolveGhostCode: resolveGhost.code,
  resolveEmptyError: resolveEmpty.success === false,
  resolveWrongTypeError: resolveWrongType.success === false || resolveWrongType.skipped === true,
}
return result
```

| Check                   | Expected                         |
| ----------------------- | -------------------------------- |
| `badTypeError`          | `true` (invalid vocabulary term) |
| `badTypeCode`           | `"VALIDATION_ERROR"`             |
| `badTypeHasSuggestion`  | `true` (lists valid types)       |
| `noTypeError`           | `true` (flag_type required)      |
| `noMessageError`        | `true` (message required)        |
| `emptyError`            | `true` (both required)           |
| `resolveGhostError`     | `true` (entry not found)         |
| `resolveGhostCode`      | `"RESOURCE_NOT_FOUND"`           |
| `resolveEmptyError`     | `true` (flag_id required)        |
| `resolveWrongTypeError` | `true` (entry is not a flag)     |

### 28.14 Flag Resolution Lifecycle

```javascript
// Test code:

// Create a flag to resolve
const flag = await mj.team.passTeamFlag({
  project_number: 5, flag_type: 'blocker',
  message: 'CM test flag for resolution',
  project_number: 5,
})
const flagId = flag.entry?.id

// Resolve with comment
const resolved = await mj.team.resolveTeamFlag({
  flag_id: flagId,
  resolution: 'Fixed by migration hotfix',
})

// Verify resolved state
const after = await mj.team.teamGetEntryById({project_number: 5,  project_number: 5, entry_id: flagId })
const afterCtx = after.entry?.flagMetadata || null

// Idempotent re-resolve
const reResolved = await mj.team.resolveTeamFlag({
  flag_id: flagId,
  resolution: 'Should not overwrite',
})

// Resolve without comment
const flag2 = await mj.team.passTeamFlag({
  project_number: 5, flag_type: 'fyi',
  message: 'CM bare resolve test',
  project_number: 5,
})
const bareResolved = await mj.team.resolveTeamFlag({ flag_id: flag2.entry?.id })

const result = {
  resolveSuccess: resolved.success,
  resolvedFlagType: resolved.flag_type,
  resolvedState: resolved.resolved,
  resolvedResolution: resolved.resolution,
  contentHasMarker: after.entry?.content?.includes('[RESOLVED:'),
  autoCtxResolved: afterCtx?.resolved,
  autoCtxResolvedAt: typeof afterCtx?.resolved_at === 'string',
  autoCtxResolution: afterCtx?.resolution,
  reResolveSuccess: reResolved.success,
  reResolveIdempotent: reResolved.resolved === true,
  reResolveOriginal: reResolved.resolution === 'Fixed by migration hotfix',
  bareResolveSuccess: bareResolved.success,
  bareResolveNoComment: bareResolved.resolution === null,
}
return result
```

| Check                  | Expected                              |
| ---------------------- | ------------------------------------- |
| `resolveSuccess`       | `true`                                |
| `resolvedFlagType`     | `"blocker"`                           |
| `resolvedState`        | `true`                                |
| `resolvedResolution`   | `"Fixed by migration hotfix"`         |
| `contentHasMarker`     | `true` (content appended)             |
| `autoCtxResolved`      | `true`                                |
| `autoCtxResolvedAt`    | `true` (ISO timestamp)                |
| `autoCtxResolution`    | `"Fixed by migration hotfix"`         |
| `reResolveSuccess`     | `true` (idempotent)                   |
| `reResolveIdempotent`  | `true` (still resolved)               |
| `reResolveOriginal`    | `true` (original resolution retained) |
| `bareResolveSuccess`   | `true`                                |
| `bareResolveNoComment` | `true` (null resolution)              |

### 28.15 Flag Search & List (team_list_flags)

```javascript
// Test code:

// Search flags by tag (legacy approach — still works)
const tagSearch = await mj.team.teamSearch({project_number: 5, tags: ['flag:blocker'] })

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
const blockersOnly = await mj.team.teamListFlags({ project_number: 5, status: 'all', flag_type: 'blocker' })

// New: team_list_flags — filter by target_user (with @ prefix — should be stripped)
const sarahFlags = await mj.team.teamListFlags({ project_number: 5, status: 'all', target_user: '@sarah' })

// New: team_list_flags — sort by priority (blockers before fyi)
const prioritySorted = await mj.team.teamListFlags({ project_number: 5, status: 'all', sort_by: 'priority' })

// New: team_list_flags — sort by timestamp
const timeSorted = await mj.team.teamListFlags({ project_number: 5, status: 'all', sort_by: 'timestamp' })

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
  hasEnrichedShape: firstFlag !== null && 'age_hours' in firstFlag && 'is_stale' in firstFlag && 'flag_type' in firstFlag,
  hasCountSummary: typeof allFlags.active_count === 'number' && typeof allFlags.resolved_count === 'number',
}
return result
```

| Check                       | Expected                                       |
| --------------------------- | ---------------------------------------------- |
| `tagSearchCount`            | ≥ 1                                            |
| `typeSearchCount`           | ≥ 1                                            |
| `typeSearchAllFlags`        | `true` (filter enforced)                       |
| `activeOnlySuccess`         | `true`                                         |
| `activeOnlyCount`           | ≥ 1 (flags from 28.12 still active)            |
| `activeOnlyAllUnresolved`   | `true` (default status=active)                 |
| `allFlagsCount`             | ≥ 4 (includes active + resolved)               |
| `allFlagsHasActive`         | `true`                                         |
| `allFlagsHasResolved`       | `true`                                         |
| `resolvedOnlyAllResolved`   | `true` (only resolved flags)                   |
| `blockersOnlyAllBlocker`    | `true` (type filter works)                     |
| `sarahFlagsAllSarah`        | `true` (target filter works, @ stripped)        |
| `prioritySortFirstType`     | `"blocker"` (highest priority)                 |
| `hasEnrichedShape`          | `true` (parsed FlagContext inline)             |
| `hasCountSummary`           | `true` (active_count and resolved_count)       |

### 28.16 Flag Update & Metadata Mutation (team_update_flag)

```javascript
// Test code:

// Get an active flag to update (from 28.12 — the fyi flag)
const activeFyi = await mj.team.teamListFlags({
  project_number: 5, status: 'active', flag_type: 'fyi',
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

| Check                  | Expected                                        |
| ---------------------- | ----------------------------------------------- |
| `escalateSuccess`      | `true`                                          |
| `escalateType`         | `"blocker"`                                     |
| `escalateChanges`      | array containing `"flag_type: fyi → blocker"`   |
| `reassignSuccess`      | `true`                                          |
| `reassignChanges`      | array containing target_user change             |
| `linkedSuccess`        | `true`                                          |
| `linkedChanges`        | array containing `"link: updated"`              |
| `editedSuccess`        | `true`                                          |
| `editedChanges`        | array containing `"message: updated"`           |
| `clearedSuccess`       | `true`                                          |
| `clearedChanges`       | array containing target_user cleared            |
| `noopSuccess`          | `true`                                          |
| `noopChanges`          | `0` (no changes made)                           |
| `finalFlagType`        | `"blocker"` (escalated)                         |
| `finalTarget`          | `"cleared"` (null after clear)                  |
| `finalLink`            | `"https://github.com/example/issue/99"`         |
| `updateGhostError`     | `true` (not found)                              |
| `updateGhostCode`      | `"RESOURCE_NOT_FOUND"`                          |
| `updateBadVocabError`  | `true` (invalid vocabulary)                     |
| `updateBadVocabCode`   | `"VALIDATION_ERROR"`                            |
| `updateNonFlagError`   | `true` (not a flag entry)                       |

### 28.17 Flag Reopen Lifecycle (team_update_flag reopen)

```javascript
// Test code:

// Create and resolve a flag
const flag = await mj.team.passTeamFlag({
  project_number: 5, flag_type: 'needs_review',
  message: 'CM reopen lifecycle test flag',
})
const flagId = flag.entry?.id

await mj.team.resolveTeamFlag({
  flag_id: flagId,
  resolution: 'Reviewed and approved',
})

// Verify it's resolved
const afterResolve = await mj.team.teamListFlags({
  project_number: 5, status: 'resolved',
})
const isResolved = afterResolve.flags?.some((f) => f.id === flagId) ?? false

// Reopen it
const reopened = await mj.team.teamUpdateFlag({
  flag_id: flagId,
  reopen: true,
})

// Verify it's active again
const afterReopen = await mj.team.teamListFlags({
  project_number: 5, status: 'active',
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

| Check                    | Expected                                |
| ------------------------ | --------------------------------------- |
| `isResolved`             | `true` (flag in resolved list)          |
| `reopenSuccess`          | `true`                                  |
| `reopenChanges`          | array containing `"reopened"`           |
| `reopenResolved`         | `false` (now active)                    |
| `isActive`               | `true` (flag in active list)            |
| `ctxResolved`            | `false`                                 |
| `ctxResolvedAt`          | `null` (cleared)                        |
| `ctxResolution`          | `null` (cleared)                        |
| `contentNoMarker`        | `true` ([RESOLVED] removed)            |
| `reopenActiveNoChange`   | `true` (no-op when already active)     |

### 28.18 Flag Analytics (team_get_flag_analytics)

```javascript
// Test code:

// Get analytics for the test project (flags created in prior phases)
const analytics = await mj.team.teamGetFlagAnalytics({ project_number: 5 })

// Analytics with different periods
const daily = await mj.team.teamGetFlagAnalytics({ project_number: 5, period: 'day' })
const monthly = await mj.team.teamGetFlagAnalytics({ project_number: 5, period: 'month' })

// Verify structure
const result = {
  analyticsSuccess: analytics.success,
  hasSummary: analytics.summary !== undefined,
  totalFlags: analytics.summary?.total_flags ?? -1,
  activeFlags: analytics.summary?.active_flags ?? -1,
  resolvedFlags: analytics.summary?.resolved_flags ?? -1,
  hasAvgResolution: 'avg_resolution_hours' in (analytics.summary || {}),
  hasMedianResolution: 'median_resolution_hours' in (analytics.summary || {}),
  hasStaleCount: typeof analytics.summary?.stale_count === 'number',
  hasByType: analytics.by_type !== undefined,
  byTypeHasBlocker: 'blocker' in (analytics.by_type || {}),
  byTypeBlockerShape: analytics.by_type?.blocker
    ? typeof analytics.by_type.blocker.total === 'number' &&
      typeof analytics.by_type.blocker.active === 'number'
    : false,
  hasByTarget: Array.isArray(analytics.by_target),
  byTargetShape: analytics.by_target?.[0]
    ? 'user' in analytics.by_target[0] &&
      'received' in analytics.by_target[0] &&
      'active' in analytics.by_target[0]
    : true, // empty array is fine
  hasTrend: analytics.trend !== undefined,
  trendShape: analytics.trend
    ? typeof analytics.trend.current_period === 'number' &&
      typeof analytics.trend.previous_period === 'number'
    : false,
  dailySuccess: daily.success,
  monthlySuccess: monthly.success,
  countsConsistent:
    (analytics.summary?.total_flags ?? 0) ===
    (analytics.summary?.active_flags ?? 0) + (analytics.summary?.resolved_flags ?? 0),
}
return result
```

| Check                 | Expected                                         |
| --------------------- | ------------------------------------------------ |
| `analyticsSuccess`    | `true`                                           |
| `hasSummary`          | `true`                                           |
| `totalFlags`          | ≥ 4 (flags from prior phases)                    |
| `activeFlags`         | ≥ 1                                              |
| `resolvedFlags`       | ≥ 1                                              |
| `hasAvgResolution`    | `true`                                           |
| `hasMedianResolution` | `true`                                           |
| `hasStaleCount`       | `true`                                           |
| `hasByType`           | `true`                                           |
| `byTypeHasBlocker`    | `true` (blocker flags exist)                     |
| `byTypeBlockerShape`  | `true` (has total and active)                    |
| `hasByTarget`         | `true`                                           |
| `byTargetShape`       | `true` (user, received, active)                  |
| `hasTrend`            | `true`                                           |
| `trendShape`          | `true` (current_period, previous_period)         |
| `dailySuccess`        | `true`                                           |
| `monthlySuccess`      | `true`                                           |
| `countsConsistent`    | `true` (total = active + resolved)               |

### 28.19 Flag Resources & Cleanup

```javascript
// Test code:

// Note: MCP Resources (memory://flags) cannot be read via Code Mode.
// Agents should use the read_resource tool instead. This test now only
// verifies cleanup of test artifacts.

// Cleanup: delete all CM test flag entries using team_list_flags
const allCmFlags = await mj.team.teamListFlags({ project_number: 5, status: 'all', limit: 100 })
const cmFlagIds = (allCmFlags.flags || [])
  .filter((f) => f.message?.includes('CM') || f.message?.includes('linting rule') || f.message?.includes('Authentication') || f.message?.includes('race condition') || f.message?.includes('FK constraint') || f.message?.includes('reopen lifecycle') || f.message?.includes('Escalated: linting rule now blocking CI pipeline'))
  .map((f) => f.id)

const uniqueIds = [...new Set(cmFlagIds)]
let deleted = 0
for (const id of uniqueIds) {
  const r = await mj.team.teamDeleteEntry({ project_number: 5, entry_id: id, permanent: true })
  if (r.success) deleted++
}

const result = {
  cleanedUp: deleted,
  cleanedAll: deleted === uniqueIds.length,
}
return result
```

| Check                | Expected                              |
| -------------------- | ------------------------------------- |
| `cleanedAll`         | `true` (all test entries deleted)     |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

### Pass/Resolve (28.12–28.14)
- `team_pass_flag(project_number: 5)` creates entries with `entry_type: 'flag'` and structured `auto_context`
- Flag tags include `flag:{type}` and `@{target}` when target_user is provided
- `@` prefix on `target_user` is stripped before storage
- Invalid vocabulary terms return `VALIDATION_ERROR` with suggestion listing valid types
- Missing required fields (`flag_type`, `message`) return structured validation errors
- `team_resolve_flag(project_number: 5)` transitions flag to resolved state with `[RESOLVED]` content marker
- Resolution comment is stored in both content and `auto_context.resolution`
- Idempotent: re-resolving an already-resolved flag returns success with original state
- Resolving a non-flag entry returns `VALIDATION_ERROR`
- Resolving a nonexistent entry returns `RESOURCE_NOT_FOUND`

### List/Query (28.15)
- `team_list_flags(project_number: 5)` defaults to `status: "active"` (only unresolved flags)
- Filtering by `status`, `flag_type`, `target_user` works correctly
- `target_user` filter strips `@` prefix for matching
- `sort_by: "priority"` returns blockers before fyi
- Response includes enriched flag objects with `age_hours`, `is_stale`, parsed metadata
- Response includes `active_count` and `resolved_count` summary

### Update/Mutate (28.16–28.17)
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

### Analytics (28.18)
- `team_get_flag_analytics(project_number: 5)` returns `summary` with total/active/resolved counts
- `summary` includes `avg_resolution_hours`, `median_resolution_hours`, `stale_count`
- `by_type` breaks down by flag type with `total`, `active`, `avg_resolution_hours`
- `by_target` lists users with `received` and `active` counts
- `trend` compares `current_period` vs `previous_period` with `change_pct`
- `total_flags === active_flags + resolved_flags`

### Resources (28.19)
- `memory://flags` returns `activeFlags` array
- `memory://flags/vocabulary` returns vocabulary with count and isDefault
- `memory://flags/history` returns `resolved_flags` array with `count`, `avg_resolution_hours`, `window_days: 7`
- All test entries cleaned up after testing
