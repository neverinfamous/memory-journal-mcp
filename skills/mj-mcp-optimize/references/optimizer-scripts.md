# Journal Optimizer Scripts

Reference implementations for the workflows defined in `SKILL.md`. Use these code blocks via `mj_execute_code` when conducting database optimization.

## Workflow 1: Importance Audit

**Step 1 & 2 — Gather statistics and score entries:**

```javascript
const s = await mj.analytics.getStatistics()
const all = await mj.core.getRecentEntries({ limit: 500 })
const tiers = { critical: [], high: [], moderate: [], low: [], expendable: [] }

for (const e of all.entries) {
  const score = e.importanceScore ?? 0
  if (score >= 0.5) tiers.critical.push(e)
  else if (score >= 0.3) tiers.high.push(e)
  else if (score >= 0.15) tiers.moderate.push(e)
  else if (score > 0) tiers.low.push(e)
  else tiers.expendable.push(e)
}

return {
  total: s.totalEntries,
  density: s.relationshipComplexity?.avgPerEntry,
  types: s.entriesByType,
  distribution: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, v.length])),
  expendableSample: tiers.expendable.slice(0, 10).map((e) => ({
    id: e.id,
    type: e.entryType,
    tags: e.tags,
    age: Math.floor((Date.now() - new Date(e.timestamp).getTime()) / 86400000) + 'd',
    snippet: e.content.substring(0, 80),
  })),
  lowSample: tiers.low.slice(0, 5).map((e) => ({
    id: e.id,
    score: e.importanceScore,
    type: e.entryType,
    snippet: e.content.substring(0, 80),
  })),
}
```

## Workflow 2: Targeted Cleanup

**Execute soft-delete batch:**

```javascript
const ids = [
  /* user-approved IDs */
]
const backup = await mj.backup.backupJournal()
if (!backup.success) return { error: 'Backup failed — aborting', backup }

const results = []
for (const id of ids) {
  const r = await mj.admin.deleteEntry({ entry_id: id })
  results.push({ id, success: r.success })
}

const ok = results.filter((r) => r.success).length
const fail = results.filter((r) => !r.success).length

await mj.core.createEntry({
  content: `Database optimization: soft-deleted ${ok} entries (batch). Backup: ${backup.filename}`,
  entry_type: 'maintenance',
  tags: ['database-optimizer', 'cleanup'],
})

return { deleted: ok, failed: fail, backupFile: backup.filename }
```

## Workflow 3: Orphan Cleanup

**Get statistics and retrieve orphaned entries:**

```javascript
const s = await mj.analytics.getStatistics()
const all = await mj.core.getRecentEntries({ limit: 500, sort_by: 'importance' })
const orphans = all.entries.filter((e) => Object.keys(e.relationships || {}).length === 0)
return {
  total: s.totalEntries,
  orphans: orphans.slice(0, 50).map((e) => ({
    id: e.id,
    type: e.entryType,
    tags: e.tags,
    significance: e.significanceType,
    age: Math.floor((Date.now() - new Date(e.timestamp).getTime()) / 86400000) + 'd',
    snippet: e.content.substring(0, 80),
  })),
}
```

## Workflow 4: Duplicate Detection

**Identify candidate duplicates:**

```javascript
const recent = await mj.core.getRecentEntries({ limit: 50 })
const candidates = []

for (const entry of recent.entries) {
  const similar = await mj.search.semanticSearch({
    query: entry.content.substring(0, 200),
    limit: 5,
  })
  for (const match of similar.entries) {
    if (match.id !== entry.id && match.similarity > 0.85) {
      candidates.push({
        entryA: {
          id: entry.id,
          score: entry.importanceScore,
          snippet: entry.content.substring(0, 60),
        },
        entryB: {
          id: match.id,
          score: match.importanceScore,
          snippet: match.content.substring(0, 60),
        },
        similarity: match.similarity,
      })
    }
  }
}

const seen = new Set()
const unique = candidates.filter((c) => {
  const key = [Math.min(c.entryA.id, c.entryB.id), Math.max(c.entryA.id, c.entryB.id)].join('-')
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

return { duplicatePairs: unique.length, pairs: unique.slice(0, 15) }
```

## Workflow 5: Type-Based Cleanup

**Preview matching entries:**

```javascript
const cutoff = new Date()
cutoff.setDate(cutoff.getDate() - 30) // user-specified days
const matches = await mj.search.searchByDateRange({
  start_date: '2020-01-01',
  end_date: cutoff.toISOString().split('T')[0],
  entry_type: 'personal_reflection',
  limit: 100, // Update type as needed
})
return matches.entries.map((e) => ({
  id: e.id,
  score: e.importanceScore,
  tags: e.tags,
  snippet: e.content.substring(0, 80),
}))
```

## Workflow 6: Test Artifact Cleanup

**Identify and execute soft-delete on test artifacts:**

```javascript
const backup = await mj.backup.backupJournal()
if (!backup.success) return { error: 'Backup failed — aborting' }

// Note: Use loop with offset if > 500 entries
const p1 = await mj.core.getRecentEntries({ limit: 500 }) 
const allEntries = p1.entries || []
const targetIds = []

for (const e of allEntries) {
  const contentLC = (e.content || '').toLowerCase()
  const titleLC = (e.title || '').toLowerCase()
  if (e.entryType === 'test_entry') {
    targetIds.push(e.id)
  } else if (
    (contentLC.includes('codemode') || contentLC.includes('test entry') || e.tags?.includes('test')) 
    && e.entryType !== 'retrospective' 
    && e.entryType !== 'bug_fix' 
    && e.entryType !== 'technical_note'
  ) {
    targetIds.push(e.id)
  }
}

const results = { ok: 0, fail: 0 }
for (const id of targetIds) {
  const r = await mj.admin.deleteEntry({ entry_id: id })
  if (r.success) results.ok++
  else results.fail++
}

if (results.ok > 0) {
  await mj.core.createEntry({
    content: `Database optimization: soft-deleted ${results.ok} test artifacts. Backup: ${backup.filename}`,
    entry_type: 'maintenance',
    tags: ['database-optimizer', 'cleanup']
  })
}

return { targetFound: targetIds.length, deleted: results.ok, failed: results.fail }
```

## Revert Guide

**Find and restore backup:**

```javascript
// Step 1: list backups
const backups = await mj.backup.listBackups()
console.log(backups.backups)

// Step 2: restore (uncomment and supply filename)
// await mj.backup.restoreBackup({ filename: 'pre-cleanup-backup-TIMESTAMP.db' });
```
