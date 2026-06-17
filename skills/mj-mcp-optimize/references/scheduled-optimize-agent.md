# Scheduled Optimizer Agent Reference

This document provides the executable scripts and workflow definitions for the `mj-mcp-optimize` scheduled agent.

## Execution Preamble

When invoked, the scheduled agent must:
1. Parse `scheduled-config.json` to obtain execution parameters and the list of projects.
2. For EACH project in the config's `projects` array, sequentially execute Phases 1 through 3.
3. After all projects are processed, execute Phase 4 EXACTLY ONCE to create a consolidated maintenance report.

> [!IMPORTANT]
> - NEVER delete entries. Do not call `delete_entry` or `batch_delete_entries`.
> - Respect all limits and caps from the configuration.

## Phase 1: Read-Only Audit

Execute these scripts for the current `PROJECT` using `mj_execute_code`.

### 1a — Importance Audit
```javascript
const s = await mj.analytics.getStatistics({ project_number: PROJECT.projectNumber })
const all = await mj.core.getRecentEntries({ project_number: PROJECT.projectNumber, limit: 500 })
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
    id: e.id, type: e.entryType, tags: e.tags,
    age: Math.floor((Date.now() - new Date(e.timestamp).getTime()) / 86400000) + 'd',
    snippet: e.content.substring(0, 80),
  })),
}
```

### 1b — Tag Consistency Scan
```javascript
const tags = await mj.core.listTags({ project_number: PROJECT.projectNumber })
const tagNames = tags.tags.map(t => t.name)

function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i-1][j] + 1, m[i][j-1] + 1, m[i-1][j-1] + (a[i-1] !== b[j-1] ? 1 : 0))
  return m[a.length][b.length]
}

function normalize(t) { return t.replace(/[-_]/g, '').toLowerCase() }

const groups = new Map()
for (const tag of tagNames) {
  const norm = normalize(tag)
  if (!groups.has(norm)) groups.set(norm, [])
  groups.get(norm).push(tag)
}

const exactDupes = [...groups.entries()]
  .filter(([, v]) => v.length > 1)
  .map(([norm, variants]) => ({ canonical: norm, variants, norm }))

let fuzzy = []
const norms = [...new Set([...groups.keys()])]
if (tagNames.length <= 200) { // O(n^2) guard
for (let i = 0; i < norms.length; i++) {
  for (let j = i + 1; j < norms.length; j++) {
    const d = lev(norms[i], norms[j])
    if (d > 0 && d <= 2 && norms[i].length > 4 && norms[j].length > 4) {
      fuzzy.push({ a: groups.get(norms[i]), b: groups.get(norms[j]), distance: d })
    }
  }
}
}

return { exactDuplicates: exactDupes, fuzzyNearMatches: fuzzy.slice(0, 20), totalTags: tagNames.length }
```

### 1c — Stale Entry Detection
```javascript
const all = await mj.core.getRecentEntries({ project_number: PROJECT.projectNumber, limit: 500, sort_by: 'importance', sort_dir: 'asc' })
// Inject values from parsed scheduled-config.json
const STALE_DAYS = CONFIG.staleOlderThanDays 
const STALE_THRESHOLD = CONFIG.staleImportanceThreshold 
const cutoff = Date.now() - (STALE_DAYS * 86400000)

const stale = all.entries.filter(e => {
  const created = new Date(e.timestamp).getTime()
  const relCount = Object.keys(e.relationships || {}).length
  const score = e.importanceScore ?? 0
  return created < cutoff && relCount === 0 && score < STALE_THRESHOLD
})

return {
  staleCount: stale.length,
  stale: stale.slice(0, 25).map(e => ({
    id: e.id, type: e.entryType, tags: e.tags,
    score: e.importanceScore, significance: e.significanceType || null,
    age: Math.floor((Date.now() - new Date(e.timestamp).getTime()) / 86400000) + 'd',
    snippet: e.content.substring(0, 80),
  })),
}
```

## Phase 2: Non-Destructive Enrichment

### 2a — Orphan Auto-Link
```javascript
const all = await mj.core.getRecentEntries({ project_number: PROJECT.projectNumber, limit: 500 })
const orphans = all.entries.filter(e => Object.keys(e.relationships || {}).length === 0)

const linked = []
// Inject values from parsed scheduled-config.json
const MAX_AUTO_LINKS = CONFIG.orphanAutoLinkMaxPerRun 

for (const orphan of orphans.slice(0, CONFIG.orphanScanLimit)) {
  if (linked.length >= MAX_AUTO_LINKS) break

  const similar = await mj.search.semanticSearch({
    project_number: PROJECT.projectNumber,
    query: orphan.content.substring(0, 200),
    limit: 3,
  })

  for (const match of similar.entries) {
    if (match.id !== orphan.id && match.similarity > CONFIG.orphanAutoLinkSimilarityThreshold && linked.length < MAX_AUTO_LINKS) {
      const target = all.entries.find(e => e.id === match.id)
      if (target && Object.keys(target.relationships || {}).length > 0) {
        await mj.relationships.linkEntries({
          project_number: PROJECT.projectNumber,
          source_id: orphan.id,
          target_id: match.id,
          relationship_type: 'references',
        })
        linked.push({
          orphanId: orphan.id, linkedTo: match.id,
          similarity: match.similarity,
          orphanSnippet: orphan.content.substring(0, 60),
          targetSnippet: match.content.substring(0, 60),
        })
      }
    }
  }
}

return { autoLinked: linked.length, links: linked }
```

### 2b — Tag Normalization
Use the `merge_tags` tool directly (not via Code Mode). Iterate over `exactDuplicates` from Phase 1b and call `merge_tags({ source_tag: "variant", target_tag: "canonical-kebab-form" })` for each variant in the group, merging into the alphabetically-first kebab-case form.

## Phase 3: Detection-Only (Report Candidates)

### 3a — Duplicate Detection
Use the code snippet from `optimizer-scripts.md` Workflow 4, bound by `duplicateScanLimit` and `duplicateSimilarityThreshold`.

### 3b — Delete Candidates
Aggregate expendable-tier entries (Phase 1a), stale entries (Phase 1c), and the lower-scored duplicate in each pair (Phase 3a) into a candidate list for human review. DO NOT DELETE.

## Phase 4: Consolidated Report

Execute this Phase EXACTLY ONCE at the end, using `create_entry` for the `memory-journal-mcp` project (or appropriate admin project):

```javascript
await mj.core.createEntry({
  project_number: 5, // memory-journal-mcp project
  content: `## Scheduled Optimization Report — ${new Date().toLocaleDateString()}

**Run Status:** ${report.status} (Completed ${report.projects.length} projects)

### Projects Audited
${report.projects.map(p => `- **${p.name}** (#${p.projectNumber})`).join('\\n')}

### Importance Distribution (All Projects)
| Tier | Count |
|------|-------|
| Critical (≥0.50) | ${report.importance.critical} |
| High (≥0.30) | ${report.importance.high} |
| Moderate (≥0.15) | ${report.importance.moderate} |
| Low (>0.00) | ${report.importance.low} |
| Expendable (0.00) | ${report.importance.expendable} |

### Tag Health
- **Exact duplicates found:** ${report.tags.exactDupes} → **auto-merged ${report.tags.autoMerged}**
- **Fuzzy near-matches:** ${report.tags.fuzzyMatches} (manual review needed)

### Relationship Health
- **Orphaned entries:** ${report.orphans.total}
- **Auto-linked this run:** ${report.orphans.autoLinked}
- **Remaining orphans:** ${report.orphans.remaining}

### Duplicate Pairs
- **Pairs detected (>${report.config.duplicateSimilarityThreshold * 100}% similarity):** ${report.duplicates.pairsFound}

### Stale Entries
- **Flagged (>${report.config.staleOlderThanDays}d, 0 rels, <${report.config.staleImportanceThreshold} importance):** ${report.stale.count}

### 🔴 Action Required
- **${report.deleteCandidates.count} entries** flagged for review
- Run \\\`mj-mcp-optimize\\\` Workflow 2 (Targeted Cleanup) to process candidates interactively`,
  entry_type: 'technical_note',
  tags: ['database-optimizer', 'scheduled-report', 'health-check'],
})
```
