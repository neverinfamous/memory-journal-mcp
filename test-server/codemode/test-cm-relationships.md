# Re-Test memory-journal-mcp — Code Mode: Relationships & Visualization

Test relationship linking (all types), duplicate detection, error paths, and Mermaid visualization through Code Mode.

**Scope:** 1 tool (`mj_execute_code`), Phase 24 — ~5 test cases covering relationships and visualization via Code Mode.

**Prerequisites:**

- Code Mode is included in all tool filtering presets by default.
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

## Phase 24: Relationships & Visualization via Code Mode

### 24.1 Link Entries — All Relationship Types

```javascript
// Test code:
const r = await mj.core.getRecentEntries({ limit: 4 })
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
const r = await mj.core.getRecentEntries({ limit: 2 })
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
const r = await mj.core.getRecentEntries({ limit: 1 })
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
  badNotFound: !!vizBad.message && vizBad.message.includes('not found'),
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
const cmEntries = await mj.search.searchEntries({ query: 'CodeMode', limit: 50 })
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

- [ ] All relationship types (`references`, `implements`, `blocked_by`, `resolved`, `caused`) create via Code Mode
- [ ] `link_entries` with `description` persists the description
- [ ] Duplicate detection returns `duplicate: true`
- [ ] Nonexistent IDs return `success: false` with descriptive message
- [ ] `visualize_relationships` returns Mermaid with legend, supports tags/depth/limit filters
- [ ] Nonexistent entry ID returns "not found" message
