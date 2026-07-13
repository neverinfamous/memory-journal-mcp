# Re-Test memory-journal-mcp — Code Mode: Relationships & Visualization

Test relationship linking (all types), duplicate detection, error paths, and Mermaid visualization through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 24 — ~5 test cases covering relationships and visualization via Code Mode.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 24: Relationships & Visualization via Code Mode

### 24.1 Link Entries — All Relationship Types

```javascript
// Test code:
const r = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 4 })
const ids = r.entries.map((e) => e.id)
if (ids.length < 4) return { error: 'Need at least 4 entries' }

const ref = await mj.relationships.linkEntries({
  from_entry_id: ids[0],
  to_entry_id: ids[1],
  relationship_type: 'references',
})
const impl = await mj.relationships.linkEntries({
  from_entry_id: ids[0],
  to_entry_id: ids[2],
  relationship_type: 'implements',
  description: 'Implements the spec',
})
const blocked = await mj.relationships.linkEntries({
  from_entry_id: ids[0],
  to_entry_id: ids[3],
  relationship_type: 'blocked_by',
})
const resolved = await mj.relationships.linkEntries({
  from_entry_id: ids[1],
  to_entry_id: ids[2],
  relationship_type: 'resolved',
})
const caused = await mj.relationships.linkEntries({
  from_entry_id: ids[2],
  to_entry_id: ids[3],
  relationship_type: 'caused',
})
return {
  refSuccess: ref.success,
  implSuccess: impl.success,
  implHasDesc: !!impl.relationship?.description,
  blockedSuccess: blocked.success,
  resolvedSuccess: resolved.success,
  causedSuccess: caused.success,
  entryIds: ids,
}
```

| Check          | Expected |
| -------------- | -------- |
| All `*Success` | `true`   |
| `implHasDesc`  | `true`   |

### 24.2 Link Entries — Duplicate & Error Paths

```javascript
// Test code (run after 24.1):
const r = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 2 })
const [a, b] = r.entries.map((e) => e.id)

const dup = await mj.relationships.linkEntries({
  from_entry_id: a,
  to_entry_id: b,
  relationship_type: 'references',
})
const reverse = await mj.relationships.linkEntries({
  from_entry_id: b,
  to_entry_id: a,
  relationship_type: 'references',
})
const badSource = await mj.relationships.linkEntries({
  from_entry_id: 999999,
  to_entry_id: b,
  relationship_type: 'references',
})
const badTarget = await mj.relationships.linkEntries({
  from_entry_id: a,
  to_entry_id: 999999,
  relationship_type: 'references',
})
return {
  dupDetected: dup.duplicate === true,
  dupHasMessage: !!dup.message,
  reverseSuccess: reverse.success,
  badSourceFailed: badSource.success === false,
  badTargetFailed: badTarget.success === false,
}
```

| Check             | Expected                           |
| ----------------- | ---------------------------------- |
| `dupDetected`     | `true`                             |
| `reverseSuccess`  | `true` (reverse direction allowed) |
| `badSourceFailed` | `true`                             |
| `badTargetFailed` | `true`                             |

### 24.3 Visualize Relationships

```javascript
// Test code:
const r = await mj.core.getRecentEntries({ workspace_id: "test-ws", limit: 1 })
const id = r.entries[0].id

const viz = await mj.relationships.visualizeRelationships({ entry_id: id })
const vizTags = await mj.relationships.visualizeRelationships({ tags: ['architecture'] })
const vizDeep = await mj.relationships.visualizeRelationships({ entry_id: id, depth: 3 })
const vizLimit = await mj.relationships.visualizeRelationships({ entry_id: id, limit: 5 })
const vizBad = await mj.relationships.visualizeRelationships({ entry_id: 999999 })
return {
  hasMermaid: typeof viz.mermaid === 'string' && viz.mermaid.length > 0,
  hasLegend: !!viz.legend,
  entryCount: viz.entry_count,
  relCount: viz.relationship_count,
  tagVizHasMermaid: typeof vizTags.mermaid === 'string',
  deepEntryCount: vizDeep.entry_count,
  limitEntryCount: vizLimit.entry_count,
  badNotFound: !!vizBad.error && vizBad.error.includes('not found'),
}
```

| Check         | Expected |
| ------------- | -------- |
| `hasMermaid`  | `true`   |
| `hasLegend`   | `true`   |
| `entryCount`  | ≥ 1      |
| `badNotFound` | `true`   |

---

## Cleanup

After testing, remove all entries created during Phases 22-24:

```javascript
// Cleanup code:
const cmEntries = await mj.search.searchEntries({ workspace_id: "test-ws", query: 'CodeMode', limit: 50 })
const results = []
for (const e of cmEntries.entries) {
  if (
    e.content?.includes('Code Mode') &&
    (e.tags?.includes('codemode-test') || e.tags?.includes('codemode-pipeline-test'))
  ) {
    const del = await mj.admin.deleteEntry({ entry_id: e.id, permanent: true })
    results.push({ id: e.id, deleted: del.success })
  }
}
return { cleaned: results.length, details: results }
```

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- All relationship types (`references`, `implements`, `blocked_by`, `resolved`, `caused`) create via Code Mode
- `link_entries` with `description` persists the description
- Duplicate detection returns `duplicate: true`
- Nonexistent IDs return `success: false` with descriptive message
- `visualize_relationships` returns Mermaid with legend, supports tags/depth/limit filters
- Nonexistent entry ID returns "not found" message
