---
name: journal-optimizer
description: |
  Guided database pruning and optimization workflows for memory-journal-mcp.
  Uses importance scores, relationship density, and entry metadata to identify
  low-value entries for safe soft-deletion. Includes dry-run previews, backup
  gates, and revert guidance. Use when the user says "clean up the database",
  "optimize entries", "prune old entries", "database maintenance", or
  "what entries can I delete?".
---

# Journal Optimizer

Guided workflows for intelligently pruning, cleaning, and optimizing a
memory-journal-mcp database. Every operation uses the soft-delete system
as a safe first pass — entries remain recoverable via `restore_backup`
until explicitly purged.

## When to Load

Load this skill when any of these apply:

- User asks to clean up, prune, or optimize journal entries
- User asks what entries are low-value or expendable
- User wants to reduce database size or improve search relevance
- User says "database maintenance", "clean up entries", "prune",
  "optimize the database", or "what can I delete?"
- Importance scores or relationship density need investigation

## Prerequisites

The following tool groups must be enabled:

| Group | Required Tools | Purpose |
|-------|---------------|---------|
| `admin` | `delete_entry`, `update_entry` | Soft-delete entries |
| `analytics` | `get_statistics` | Importance scores, graph stats |
| `search` | `search_entries`, `search_by_date_range`, `semantic_search` | Find candidates |
| `backup` | `backup_journal`, `list_backups`, `restore_backup` | Safety net |
| `codemode` | `mj_execute_code` | Batch operations |
| `relationships` | `visualize_relationships` | Orphan detection |

If any required group is missing, inform the user and suggest adding it
via `--tool-filter` or `MEMORY_JOURNAL_MCP_TOOL_FILTER`.

## Importance Score Reference

The server computes importance scores (0.0–1.0) for every entry using
a weighted formula. Understanding this formula is essential for making
intelligent pruning decisions.

### Formula

| Component | Weight | Max Score | How It's Earned |
|-----------|--------|-----------|-----------------|
| **Significance** | 0.30 | 0.30 | Entry has a `significance_type` (milestone, decision, release, etc.) |
| **Relationships** | 0.35 | 0.35 | Entry has ≥5 relationships (linear scale: 1 rel = 0.07) |
| **Causal** | 0.20 | 0.20 | Entry has ≥3 causal relationships (`blocked_by`, `resolved`, `caused`) |
| **Recency** | 0.15 | 0.15 | Created within the last 90 days (linear decay to 0 at day 90) |

### Threshold Guide

| Score | Label | Meaning |
|-------|-------|---------|
| `0.00` | Expendable | No significance, no relationships, older than 90 days |
| `0.01–0.14` | Low | Minimal context — weak tags or a single old relationship |
| `0.15–0.29` | Moderate | Has some context but not structurally important |
| `0.30–0.49` | High | Well-connected or has significance markers |
| `0.50+` | Critical | Major decisions, densely linked entries, milestones |

> **Key insight**: Entries scoring `0.00` have zero structural value to the
> knowledge graph. They are safe to soft-delete in virtually all cases.
> Entries scoring `0.01–0.14` should be reviewed individually.

## Safety Rules

These rules are **mandatory** for all workflows:

1. **NEVER** use `permanent: true` unless the user explicitly says
   "permanent delete" or "hard delete"
2. **ALWAYS** call `backup_journal` before any batch delete — abort if
   the backup fails
3. **ALWAYS** show the user what will be deleted before deleting
4. **NEVER** delete entries with `significance_type` set without explicit
   user approval, regardless of other scores
5. **Maximum batch size**: 50 entries per operation to prevent accidental
   mass deletion
6. **Log all cleanup operations** as a journal entry with
   `entry_type: 'maintenance'` and tag `database-optimizer`

---

## Workflow 1: Importance Audit (Dry Run)

Analyze the database to surface low-importance entries without modifying
anything. This is the recommended starting point for all optimization work.

### Steps

**Step 1 — Gather statistics:**

```javascript
const s = await mj.analytics.getStatistics();
return {
  total: s.totalEntries,
  density: s.relationshipComplexity?.avgPerEntry,
  types: s.entriesByType,
};
```

**Step 2 — Score and tier all entries:**

```javascript
const all = await mj.core.getRecentEntries({ limit: 500 });
const tiers = { critical: [], high: [], moderate: [], low: [], expendable: [] };

for (const e of all.entries) {
  const score = e.importanceScore ?? 0;
  if (score >= 0.50) tiers.critical.push(e);
  else if (score >= 0.30) tiers.high.push(e);
  else if (score >= 0.15) tiers.moderate.push(e);
  else if (score > 0) tiers.low.push(e);
  else tiers.expendable.push(e);
}

return {
  distribution: Object.fromEntries(
    Object.entries(tiers).map(([k, v]) => [k, v.length])
  ),
  expendableSample: tiers.expendable.slice(0, 10).map(e => ({
    id: e.id,
    type: e.entryType,
    tags: e.tags,
    age: Math.floor((Date.now() - new Date(e.timestamp).getTime()) / 86400000) + 'd',
    snippet: e.content.substring(0, 80),
  })),
  lowSample: tiers.low.slice(0, 5).map(e => ({
    id: e.id,
    score: e.importanceScore,
    type: e.entryType,
    snippet: e.content.substring(0, 80),
  })),
};
```

**Step 3 — Present results:**

Render the distribution as a table:

| Tier | Count | Action |
|------|-------|--------|
| Critical (≥0.50) | N | Keep — these are structural anchors |
| High (0.30–0.49) | N | Keep — well-connected entries |
| Moderate (0.15–0.29) | N | Review individually if space is needed |
| Low (0.01–0.14) | N | Candidates for cleanup with user review |
| Expendable (0.00) | N | Safe to soft-delete |

Show the expendable sample with IDs, types, ages, and snippets.
Ask the user which tier(s) they want to target for cleanup.

---

## Workflow 2: Targeted Cleanup (Interactive)

Soft-delete entries matching user-selected criteria from the audit.

### Steps

1. Run **Workflow 1** if not already completed this session
2. Present the candidate list with importance breakdowns
3. **HITL Gate**: Ask user to confirm which entries to delete. Offer
   selection modes:
   - By tier: "Delete all expendable entries"
   - By age: "Delete entries older than 60 days scoring below 0.15"
   - By type: "Delete all `personal_reflection` entries scoring 0.00"
   - By ID list: "Delete entries 1234, 1235, 1240"
4. Call `backup_journal` — **abort** if backup fails
5. Execute the soft-delete batch:

```javascript
const ids = [/* user-approved IDs */];
const backup = await mj.backup.backupJournal();
if (!backup.success) return { error: 'Backup failed — aborting', backup };

const results = [];
for (const id of ids) {
  const r = await mj.admin.deleteEntry({ entry_id: id });
  results.push({ id, success: r.success });
}

const ok = results.filter(r => r.success).length;
const fail = results.filter(r => !r.success).length;
return { deleted: ok, failed: fail, backupFile: backup.filename };
```

6. Report results and log a maintenance entry:

```javascript
await mj.core.createEntry({
  content: `Database optimization: soft-deleted ${ok} entries (batch). Backup: ${backup.filename}`,
  entry_type: 'enhancement',
  tags: ['database-optimizer', 'cleanup'],
});
```

7. Provide revert instructions (see Revert Guide below)

---

## Workflow 3: Orphan Cleanup

Find and soft-delete entries with zero relationships.

### Steps

1. Get the orphan count from statistics:

```javascript
const s = await mj.analytics.getStatistics();
return { total: s.totalEntries };
```

2. Retrieve orphaned entries — these are entries with an importance score
   that has zero contributions from the `relationships` and `causal`
   components:

```javascript
const all = await mj.core.getRecentEntries({ limit: 500, sort_by: 'importance' });
const orphans = all.entries.filter(e => (e.importanceScore ?? 0) === 0);
return orphans.slice(0, 50).map(e => ({
  id: e.id,
  type: e.entryType,
  tags: e.tags,
  significance: e.significanceType,
  age: Math.floor((Date.now() - new Date(e.timestamp).getTime()) / 86400000) + 'd',
  snippet: e.content.substring(0, 80),
}));
```

3. Present the orphan list. Flag any with `significance_type` set —
   these should NOT be deleted without explicit approval
4. **HITL Gate**: User selects which orphans to delete
5. Backup → soft-delete batch → report → log maintenance entry

> **Alternative to deletion**: For orphans that have value but lack
> connections, suggest using `link_entries` to connect them to related
> entries instead of deleting them. This improves graph density.

---

## Workflow 4: Duplicate Detection

Find entries with semantically similar content that may be redundant.

### Steps

1. Identify candidate duplicates using semantic search. For each recent
   entry, search for similar entries and flag high-similarity pairs:

```javascript
const recent = await mj.core.getRecentEntries({ limit: 50 });
const candidates = [];

for (const entry of recent.entries) {
  const similar = await mj.search.semanticSearch({
    query: entry.content.substring(0, 200),
    limit: 5,
  });

  for (const match of similar.entries) {
    if (match.id !== entry.id && match.similarity > 0.85) {
      candidates.push({
        entryA: { id: entry.id, score: entry.importanceScore, snippet: entry.content.substring(0, 60) },
        entryB: { id: match.id, score: match.importanceScore, snippet: match.content.substring(0, 60) },
        similarity: match.similarity,
      });
    }
  }
}

// Deduplicate pairs (A↔B and B↔A are the same pair)
const seen = new Set();
const unique = candidates.filter(c => {
  const key = [Math.min(c.entryA.id, c.entryB.id), Math.max(c.entryA.id, c.entryB.id)].join('-');
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

return { duplicatePairs: unique.length, pairs: unique.slice(0, 15) };
```

2. Present duplicate pairs side-by-side with:
   - Both entry IDs, importance scores, and content snippets
   - Recommendation: keep the entry with the higher importance score
   - Flag pairs where both entries have relationships (merging may be
     better than deleting)
3. **HITL Gate**: User selects which duplicates to remove
4. Backup → soft-delete the lower-scoring entry from each pair → report

> **Note**: Semantic search requires the vector index. If
> `get_vector_index_stats` shows zero indexed entries, suggest running
> `rebuild_vector_index` first.

---

## Workflow 5: Type-Based Cleanup

Clean up entries by `entry_type` — useful for removing bulk categories
that were misclassified or have outlived their usefulness.

### Steps

1. Aggregate entry counts by type:

```javascript
const s = await mj.analytics.getStatistics();
return s.entriesByType;
```

2. Present the type breakdown as a table, sorted by count descending.
   Flag types that are commonly low-value:
   - `personal_reflection` — often a default misclassification
   - `retrospective` — session summaries that may be stale
   - `note` — generic entries that lack specificity

3. User selects which types to target and an age threshold (e.g.,
   "delete all `personal_reflection` entries older than 30 days")

4. Preview matching entries:

```javascript
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 30); // user-specified days
const matches = await mj.search.searchByDateRange({
  start_date: '2020-01-01',
  end_date: cutoff.toISOString().split('T')[0],
  entry_type: 'personal_reflection',
  limit: 100,
});
return matches.entries.map(e => ({
  id: e.id,
  score: e.importanceScore,
  tags: e.tags,
  snippet: e.content.substring(0, 80),
}));
```

5. **HITL Gate**: User reviews and approves the candidate list
6. Backup → soft-delete → report → log maintenance entry

---

## Revert Guide

Every workflow creates a backup before mutations. To revert:

**Step 1 — Find the backup:**
```javascript
const backups = await mj.backup.listBackups();
return backups.backups; // Find the pre-cleanup backup by timestamp
```

**Step 2 — Restore:**
```javascript
await mj.backup.restoreBackup({ filename: 'pre-cleanup-backup-TIMESTAMP.db' });
```

**Step 3 — Verify:**
```javascript
const s = await mj.analytics.getStatistics();
return { total: s.total_entries }; // Should match pre-cleanup count
```

> **Important**: Soft-deleted entries are still physically present in the
> database. They are excluded from queries but occupy disk space. The
> entries are only permanently removed when:
> - `delete_entry` is called with `permanent: true`
> - A backup is restored from a point before the soft-delete
> - The database is rebuilt from an export

---

## Post-Optimization

After completing any workflow, recommend these follow-up actions:

1. **Rebuild the vector index** to remove stale embeddings:
   `rebuild_vector_index`
2. **Run a statistics check** to verify the database health:
   `get_statistics`
3. **Log the optimization** as a journal entry for audit trail
4. **Review relationship density** — if density dropped below 2.0,
   consider linking remaining orphans to related entries

## Synergies

| Tool/Workflow | Relationship |
|---------------|-------------|
| Auto-Prune (startup) | Automated version of Workflow 2 with fixed thresholds |
| `get_statistics` | Primary data source for importance scores and graph metrics |
| `backup_journal` | Safety gate for all destructive operations |
| `restore_backup` | Revert mechanism for soft-deleted entries |
| `rebuild_vector_index` | Post-cleanup maintenance to clean stale embeddings |
| `link_entries` | Alternative to deletion — connect orphans instead of removing them |
