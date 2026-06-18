# Re-Test memory-journal-mcp — Code Mode: Team Flags Core (Hush Protocol)

Test the core Hush Protocol flag system (`team_pass_flag`, `team_resolve_flag`) through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.12 — ~10 test cases covering flag creation, vocabulary validation, and resolution lifecycle via Code Mode.
*(Advanced features like analytics and metadata mutation are in `test-cm-team-flags-advanced.md`)*

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. **Cleanup:** Ensure all testing artifacts/flags generated during this pass are fully cleaned up (permanently hard-deleted if necessary) so they do not persist in the user's Briefing.
5. After user completes verification, re-test fixes with direct MCP calls.
6. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 28: Team Flag Core Tools via Code Mode

> [!NOTE]
> Requires `TEAM_DB_PATH` to be configured. Flag tools use the `mj.team.passTeamFlag()`, `mj.team.resolveTeamFlag()` API.
>
> **Flags are team entries with `entry_type: 'flag'`** and structured `auto_context` JSON containing flag metadata.

### 28.12 Flag Creation & Vocabulary

```javascript
// Test code:
const blocker = await mj.team.passTeamFlag({
  project_number: 5,
  flag_type: 'blocker',
  message: 'FK constraint prevents migration from running',
  target_user: '@sarah',
  link: 'src/database/migrations/005.ts',
})
const fyi = await mj.team.passTeamFlag({
  project_number: 5,
  flag_type: 'fyi',
  message: 'New linting rule added for strict-boolean-expressions',
})
const review = await mj.team.passTeamFlag({
  project_number: 5,
  flag_type: 'needs_review',
  message: 'Authentication refactor ready for review',
  target_user: 'chris',
  issue_number: 42,
})
const help = await mj.team.passTeamFlag({
  project_number: 5,
  flag_type: 'help_requested',
  message: 'Cannot reproduce the race condition on Windows',
})

if (!blocker.success) return { success: false, error: blocker.error }
if (!fyi.success) return { success: false, error: fyi.error }
if (!review.success) return { success: false, error: review.error }
if (!help.success) return { success: false, error: help.error }

// Verify entry structure
const detail = await mj.team.teamGetEntryById({
  project_number: 5,
  entry_id: blocker.entry?.id,
})
if (!detail.success) return { success: false, error: detail.error }
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
  project_number: 5,
  flag_type: 'urgent',
  message: 'This should fail vocabulary check',
})

// Missing required fields
const noType = await mj.team.passTeamFlag({
  project_number: 5,
  message: 'no type',
})
const noMessage = await mj.team.passTeamFlag({
  project_number: 5,
  flag_type: 'blocker',
})
const empty = await mj.team.passTeamFlag({ project_number: 5 })

// Omit project_number parameter to test fallback / validation
const omitProject = await mj.team.passTeamFlag({
  flag_type: 'fyi',
  message: 'CM fallback test',
})

// Resolve nonexistent flag
const resolveGhost = await mj.team.resolveTeamFlag({ flag_id: 999999 })

// Resolve empty params
const resolveEmpty = await mj.team.resolveTeamFlag({})

// Resolve a non-flag entry (get a recent non-flag entry first)
const recent = await mj.team.teamGetRecent({ project_number: 5, limit: 10 })
if (!recent.success) return { success: false, error: recent.error }
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
  omitProjectValid: omitProject.success === true || (omitProject.success === false && omitProject.code === 'VALIDATION_ERROR'),
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
| `omitProjectValid`      | `true` (falls back or errors gracefully) |
| `resolveGhostError`     | `true` (entry not found)         |
| `resolveGhostCode`      | `"RESOURCE_NOT_FOUND"`           |
| `resolveEmptyError`     | `true` (flag_id required)        |
| `resolveWrongTypeError` | `true` (entry is not a flag)     |


### 28.14 Flag Resolution Lifecycle

```javascript
// Test code:

// Create a flag to resolve
const flag = await mj.team.passTeamFlag({
  project_number: 5,
  flag_type: 'blocker',
  message: 'CM test flag for resolution',
})
if (!flag.success) return { success: false, error: flag.error }
const flagId = flag.entry?.id

// Resolve with comment
const resolved = await mj.team.resolveTeamFlag({
  flag_id: flagId,
  resolution: 'Fixed by migration hotfix',
})
if (!resolved.success) return { success: false, error: resolved.error }

// Verify resolved state
const after = await mj.team.teamGetEntryById({
  project_number: 5,
  entry_id: flagId,
})
if (!after.success) return { success: false, error: after.error }
const afterCtx = after.entry?.flagMetadata || null

// Idempotent re-resolve
const reResolved = await mj.team.resolveTeamFlag({
  flag_id: flagId,
  resolution: 'Should not overwrite',
})

// Resolve without comment
const flag2 = await mj.team.passTeamFlag({
  project_number: 5,
  flag_type: 'fyi',
  message: 'CM bare resolve test',
})
if (!flag2.success) return { success: false, error: flag2.error }
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

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `team_pass_flag` creates entries with `entry_type: 'flag'` and structured `auto_context`
- Flag tags include `flag:{type}` and `@{target}` when target_user is provided
- `@` prefix on `target_user` is stripped before storage
- Invalid vocabulary terms return `VALIDATION_ERROR` with suggestion listing valid types
- Missing required fields (`flag_type`, `message`) return structured validation errors
- `team_resolve_flag` transitions flag to resolved state with `[RESOLVED]` content marker
- Resolution comment is stored in both content and `auto_context.resolution`
- Idempotent: re-resolving an already-resolved flag returns success with original state
- Resolving a non-flag entry returns `VALIDATION_ERROR`
- Resolving a nonexistent entry returns `RESOURCE_NOT_FOUND`
