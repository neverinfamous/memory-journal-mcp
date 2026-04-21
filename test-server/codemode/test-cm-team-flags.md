# Re-Test memory-journal-mcp — Code Mode: Team Flags (Hush Protocol)

Test the Hush Protocol flag system (`pass_team_flag`, `resolve_team_flag`) and flag resources through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.12–28.15 — ~12 test cases covering flag creation, vocabulary validation, resolution lifecycle, idempotency, and error paths via Code Mode.

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

## Phase 28: Team Flag Tools via Code Mode

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured. Flag tools use the `mj.team.passTeamFlag()` and `mj.team.resolveTeamFlag()` API.
>
> **Flags are team entries with `entry_type: 'flag'`** and structured `auto_context` JSON containing flag metadata.

### 28.12 Flag Creation & Vocabulary

```javascript
// Test code:
const blocker = await mj.team.passTeamFlag({
  flag_type: 'blocker',
  message: 'FK constraint prevents migration from running',
  target_user: '@sarah',
  link: 'src/database/migrations/005.ts',
  project_number: 5,
})
const fyi = await mj.team.passTeamFlag({
  flag_type: 'fyi',
  message: 'New linting rule added for strict-boolean-expressions',
})
const review = await mj.team.passTeamFlag({
  flag_type: 'needs_review',
  message: 'Authentication refactor ready for review',
  target_user: 'chris',
  issue_number: 42,
})
const help = await mj.team.passTeamFlag({
  flag_type: 'help_requested',
  message: 'Cannot reproduce the race condition on Windows',
})

// Verify entry structure
const detail = await mj.team.teamGetEntryById({ entry_id: blocker.entry?.id })
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
};
return result;
```

| Check             | Expected                                |
| ----------------- | --------------------------------------- |
| `blockerSuccess`  | `true`                                  |
| `blockerFlagType` | `"blocker"`                             |
| `blockerTarget`   | `"sarah"` (@ prefix stripped)           |
| `blockerResolved` | `false`                                 |
| `blockerHasAuthor`| `true`                                  |
| `fyiSuccess`      | `true`                                  |
| `reviewSuccess`   | `true`                                  |
| `helpSuccess`     | `true`                                  |
| `entryType`       | `"flag"`                                |
| `hasTags`         | `true`                                  |
| `hasTargetTag`    | `true`                                  |
| `autoCtxFlagType` | `"blocker"`                             |
| `autoCtxTarget`   | `"sarah"`                               |
| `autoCtxLink`     | `"src/database/migrations/005.ts"`      |
| `autoCtxResolved` | `false`                                 |

### 28.13 Vocabulary Validation & Error Paths

```javascript
// Test code:

// Invalid vocabulary term
const badType = await mj.team.passTeamFlag({
  flag_type: 'urgent',
  message: 'This should fail vocabulary check',
})

// Missing required fields
const noType = await mj.team.passTeamFlag({ message: 'no type' })
const noMessage = await mj.team.passTeamFlag({ flag_type: 'blocker' })
const empty = await mj.team.passTeamFlag({})

// Resolve nonexistent flag
const resolveGhost = await mj.team.resolveTeamFlag({ flag_id: 999999 })

// Resolve empty params
const resolveEmpty = await mj.team.resolveTeamFlag({})

// Resolve a non-flag entry (get a recent non-flag entry first)
const recent = await mj.team.teamGetRecent({ limit: 10 })
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
};
return result;
```

| Check                  | Expected                                      |
| ---------------------- | --------------------------------------------- |
| `badTypeError`         | `true` (invalid vocabulary term)              |
| `badTypeCode`          | `"VALIDATION_ERROR"`                          |
| `badTypeHasSuggestion` | `true` (lists valid types)                    |
| `noTypeError`          | `true` (flag_type required)                   |
| `noMessageError`       | `true` (message required)                     |
| `emptyError`           | `true` (both required)                        |
| `resolveGhostError`    | `true` (entry not found)                      |
| `resolveGhostCode`     | `"RESOURCE_NOT_FOUND"`                        |
| `resolveEmptyError`    | `true` (flag_id required)                     |
| `resolveWrongTypeError`| `true` (entry is not a flag)                  |

### 28.14 Flag Resolution Lifecycle

```javascript
// Test code:

// Create a flag to resolve
const flag = await mj.team.passTeamFlag({
  flag_type: 'blocker',
  message: 'CM test flag for resolution',
})
const flagId = flag.entry?.id

// Resolve with comment
const resolved = await mj.team.resolveTeamFlag({
  flag_id: flagId,
  resolution: 'Fixed by migration hotfix',
})

// Verify resolved state
const after = await mj.team.teamGetEntryById({ entry_id: flagId })
const afterCtx = after.entry?.flagMetadata || null

// Idempotent re-resolve
const reResolved = await mj.team.resolveTeamFlag({
  flag_id: flagId,
  resolution: 'Should not overwrite',
})

// Resolve without comment
const flag2 = await mj.team.passTeamFlag({
  flag_type: 'fyi',
  message: 'CM bare resolve test',
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
};
return result;
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

### 28.15 Flag Search & Cleanup

```javascript
// Test code:

// Search flags by tag
const tagSearch = await mj.team.teamSearch({ tags: ['flag:blocker'] })

// Search flags by entry_type
const typeSearch = await mj.team.teamSearchByDateRange({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  entry_type: 'flag',
})

// Cleanup: delete all cm-test flag entries
const allFlags = await mj.team.teamSearch({ tags: ['flag:blocker'] })
const allFyi = await mj.team.teamSearch({ tags: ['flag:fyi'] })
const allReview = await mj.team.teamSearch({ tags: ['flag:needs_review'] })
const allHelp = await mj.team.teamSearch({ tags: ['flag:help_requested'] })

const allIds = [
  ...(allFlags.entries || []),
  ...(allFyi.entries || []),
  ...(allReview.entries || []),
  ...(allHelp.entries || []),
]
  .filter((e) => e.content?.includes('CM'))
  .map((e) => e.id)

const uniqueIds = [...new Set(allIds)]
let deleted = 0
for (const id of uniqueIds) {
  const r = await mj.team.teamDeleteEntry({ entry_id: id })
  if (r.success) deleted++
}

const result = {
  tagSearchCount: tagSearch.entries?.length ?? 0,
  typeSearchCount: typeSearch.entries?.length ?? 0,
  typeSearchAllFlags: typeSearch.entries?.every((e) => e.entryType === 'flag') ?? true,
  cleanedUp: deleted,
  cleanedAll: deleted === uniqueIds.length,
};
return result;
```

| Check               | Expected                         |
| ------------------- | -------------------------------- |
| `tagSearchCount`    | ≥ 1                              |
| `typeSearchCount`   | ≥ 1                              |
| `typeSearchAllFlags`| `true` (filter enforced)         |
| `cleanedAll`        | `true` (all test entries deleted)|

---

## Success Criteria

- [ ] `pass_team_flag` creates entries with `entry_type: 'flag'` and structured `auto_context`
- [ ] Flag tags include `flag:{type}` and `@{target}` when target_user is provided
- [ ] `@` prefix on `target_user` is stripped before storage
- [ ] Invalid vocabulary terms return `VALIDATION_ERROR` with suggestion listing valid types
- [ ] Missing required fields (`flag_type`, `message`) return structured validation errors
- [ ] `resolve_team_flag` transitions flag to resolved state with `[RESOLVED]` content marker
- [ ] Resolution comment is stored in both content and `auto_context.resolution`
- [ ] Idempotent: re-resolving an already-resolved flag returns success with original state
- [ ] Resolving a non-flag entry returns `VALIDATION_ERROR`
- [ ] Resolving a nonexistent entry returns `RESOURCE_NOT_FOUND`
- [ ] Flags are searchable by tag (`flag:blocker`) and by `entry_type: 'flag'`
- [ ] All test entries cleaned up after testing
