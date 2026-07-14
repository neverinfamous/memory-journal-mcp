# Re-Test memory-journal-mcp — Code Mode: Admin Core

Test tag management, configuration, staleness, and pruning operations via Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 27.1, 27.5, 27.6 — ~6 test cases.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 27: Admin Core via Code Mode

### 27.1 Tag Management

```javascript
// Test code:
const tags = await mj.core.listTags({})
const hasEntries = tags.tags?.length > 0

// Create source tag for merge
await mj.core.createEntry({
  workspace_id: "test-ws",
  content: 'CM4 merge test entry',
  tags: ['cm4-old-tag'],
})
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

### 27.5 Runtime Configuration

```javascript
// Test code:
// Change config
const configChange = await mj.admin.updateConfiguration({
  briefing_entries: 3,
  instruction_level: "essential"
})

// Revert config
const revertChange = await mj.admin.updateConfiguration({
  briefing_entries: 10,
  instruction_level: "standard"
})

return {
  configChangeSuccess: configChange.success,
  configChangeKeys: configChange.updated?.includes("briefing_entries") && configChange.updated?.includes("instruction_level"),
  revertSuccess: revertChange.success
}
```

| Check                 | Expected |
| --------------------- | -------- |
| `configChangeSuccess` | `true`   |
| `configChangeKeys`    | `true`   |
| `revertSuccess`       | `true`   |

### 27.6 Staleness & Auto Prune

```javascript
// Test code:
// markAnchorsStale
const markStale = await mj.core.markAnchorsStale({
  anchor_id: 1,
  staleness_reason: "Testing staleness marking via Code Mode"
})

// runAutoPrune
const prune = await mj.admin.runAutoPrune({
  dry_run: true
})

return {
  markStaleSuccess: markStale.success || markStale.code === "RESOURCE_NOT_FOUND",
  pruneSuccess: prune.success,
  pruneHasStats: prune.stats !== undefined
}
```

| Check                 | Expected |
| --------------------- | -------- |
| `markStaleSuccess`    | `true`   |
| `pruneSuccess`        | `true`   |
| `pruneHasStats`       | `true`   |

---

## Success Criteria

- `list_tags` returns tag list via Code Mode
- `merge_tags` consolidates tags correctly — source removed, target exists
- `merge_tags` returns structured errors for same-tag and nonexistent source
- `updateConfiguration` correctly updates server configuration via Code Mode
- `markAnchorsStale` successfully marks anchors as stale or safely ignores missing entries
- `runAutoPrune` executes dry-run successfully and returns stats
