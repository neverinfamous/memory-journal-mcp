# Re-Test memory-journal-mcp — Code Mode: Team Flags Analytics

Test the advanced Hush Protocol flag analytics.

**Scope:** 1 tool (mj_execute_code), Phase 28B.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found.
2. Use code-map.md as a source of truth.
3. If you made code changes/fixes, update UNRELEASED.md and commit.
4. Re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

---

## Phase 28B: Flag Analytics via Code Mode

### 28.18 Flag Analytics (team_get_flag_analytics)

```javascript
// Test code:

// Get analytics for the test project (flags created in prior phases)
const analytics = await mj.team.teamGetFlagAnalytics({ project_number: 5 })
if (!analytics.success) return { success: false, error: 'P401 Check: analytics failed', code: analytics.code }

// Analytics with different periods
const daily = await mj.team.teamGetFlagAnalytics({ project_number: 5, period: 'day' })
if (!daily.success) return { success: false, error: 'P401 Check: daily failed', code: daily.code }

const monthly = await mj.team.teamGetFlagAnalytics({ project_number: 5, period: 'month' })
if (!monthly.success) return { success: false, error: 'P401 Check: monthly failed', code: monthly.code }

// Omit project_number on teamGetFlagAnalytics to test fallback / validation
const omitAnalytics = await mj.team.teamGetFlagAnalytics({ period: 'day' })

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
  omitAnalyticsValid: omitAnalytics.success === true || (omitAnalytics.success === false && omitAnalytics.code === 'VALIDATION_ERROR'),
  countsConsistent:
    (analytics.summary?.total_flags ?? 0) ===
    (analytics.summary?.active_flags ?? 0) + (analytics.summary?.resolved_flags ?? 0),
}
return result
```

| Check                 | Expected                                 |
| --------------------- | ---------------------------------------- |
| `analyticsSuccess`    | `true`                                   |
| `hasSummary`          | `true`                                   |
| `totalFlags`          | ≥ 4 (flags from prior phases)            |
| `activeFlags`         | ≥ 1                                      |
| `resolvedFlags`       | ≥ 1                                      |
| `hasAvgResolution`    | `true`                                   |
| `hasMedianResolution` | `true`                                   |
| `hasStaleCount`       | `true`                                   |
| `hasByType`           | `true`                                   |
| `byTypeHasBlocker`    | `true` (blocker flags exist)             |
| `byTypeBlockerShape`  | `true` (has total and active)            |
| `hasByTarget`         | `true`                                   |
| `byTargetShape`       | `true` (user, received, active)          |
| `hasTrend`            | `true`                                   |
| `trendShape`          | `true` (current_period, previous_period) |
| `dailySuccess`        | `true`                                   |
| `monthlySuccess`      | `true`                                   |
| `omitAnalyticsValid`  | `true` (falls back or errors gracefully) |
| `countsConsistent`    | `true` (total = active + resolved)       |


### 28.19 Flag Resources & Cleanup

```javascript
// Test code:

// Note: MCP Resources (memory://flags) cannot be read via Code Mode.
// Agents should use the read_resource tool instead. This test now only
// verifies cleanup of test artifacts.

// Cleanup: delete all CM test flag entries using team_list_flags
const allCmFlags = await mj.team.teamListFlags({ project_number: 5, status: 'all', limit: 100 })
if (!allCmFlags.success) return { success: false, error: 'P401 Check: allCmFlags failed', code: allCmFlags.code }

const cmFlagIds = (allCmFlags.flags || [])
  .filter(
    (f) =>
      f.message?.includes('CM') ||
      f.message?.includes('linting rule') ||
      f.message?.includes('Authentication') ||
      f.message?.includes('race condition') ||
      f.message?.includes('FK constraint') ||
      f.message?.includes('reopen lifecycle') ||
      f.message?.includes('Escalated: linting rule now blocking CI pipeline')
  )
  .map((f) => f.id)

const uniqueIds = [...new Set(cmFlagIds)]
let deleted = 0
for (const id of uniqueIds) {
  const r = await mj.team.teamDeleteEntry({ project_number: 5, entry_id: id })
  if (r.success) deleted++
}

const result = {
  cleanedUp: deleted,
  cleanedAll: deleted === uniqueIds.length,
}
return result
```

| Check        | Expected                          |
| ------------ | --------------------------------- |
| `cleanedAll` | `true` (all test entries deleted) |

---

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
