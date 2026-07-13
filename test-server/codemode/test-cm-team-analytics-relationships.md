# Re-Test memory-journal-mcp — Code Mode: Team Analytics & Relationships

Test team analytics and relationships through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 28.5, 28.6 — ~6 test cases.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities.
2. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
3. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
3. Provide a very brief final summary including **Total Token Estimate**.

---

## Phase 28: Team Analytics & Relationships via Code Mode

### 28.5 Team Analytics

```javascript
// Test code:
const stats = await mj.team.teamGetStatistics({})
if (!stats.success) return { success: false, error: stats.error }
const monthly = await mj.team.teamGetStatistics({ group_by: 'month' })
if (!monthly.success) return { success: false, error: monthly.error }
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
const r = await mj.team.teamGetRecent({ workspace_id: "test-ws", limit: 2 })
if (!r.success) return { success: false, error: r.error }
const [a, b] = r.entries.map((e) => e.id)

const linked = await mj.team.teamLinkEntries({
  workspace_id: "test-ws",
  from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
  description: 'CM4 team link test',
})
const dup = await mj.team.teamLinkEntries({
  workspace_id: "test-ws",
  from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
})
const viz = await mj.team.teamVisualizeRelationships({ workspace_id: "test-ws", entry_id: a })
const vizTag = await mj.team.teamVisualizeRelationships({
  workspace_id: "test-ws",
  tag: 'codemode4-team-test',
})

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

---

## Success Criteria

- `team_get_statistics` returns `totalEntries`, `entriesByType`, `authors`
- `team_link_entries(workspace_id: "test-ws")` creates relationships with duplicate detection
- `team_visualize_relationships(workspace_id: "test-ws")` returns Mermaid diagram with node/edge counts
