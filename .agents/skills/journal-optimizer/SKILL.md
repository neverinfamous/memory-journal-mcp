---
name: journal-optimizer
description: |
  Guided database pruning and optimization workflows for memory-journal-mcp.
  Uses importance scores, relationship density, and entry metadata to identify
  low-value entries for safe soft-deletion. Includes dry-run previews, backup
  gates, and revert guidance. Use when the user says "clean up the database",
  "optimize entries", "prune old entries", "database maintenance",
  "what entries can I delete?", "my journal is getting too big", or "archive old entries".
---

# Journal Optimizer

Guided workflows for intelligently pruning, cleaning, and optimizing a
memory-journal-mcp database. Every operation uses the soft-delete system
as a safe first pass — entries remain recoverable via `restore_backup`
until explicitly purged.

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

## Safe Deletion Protocol

For all destructive workflows (2–5), execute this exact sequence once the candidate list is prepared:

1. **HITL Gate**: Ask the user to confirm the exact candidate list.
2. **Backup**: Call `backup_journal`. **ABORT** immediately if the backup fails.
3. **Execute**: Run the soft-delete batch script for the specific workflow (see [references/optimizer-scripts.md](references/optimizer-scripts.md)).
4. **Log & Report**: Log a maintenance entry and provide revert instructions.

---

## Workflow 1: Importance Audit (Dry Run)

Analyze the database to surface low-importance entries without modifying anything. This is the recommended starting point for all optimization work.

### Steps

**Step 1 & 2 — Gather stats and score entries:**
*Read and execute the Workflow 1 code block in [references/optimizer-scripts.md](references/optimizer-scripts.md).*

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

1. Run **Workflow 1** if not already completed this session.
2. Present the candidate list with importance breakdowns.
3. Execute the **Safe Deletion Protocol** for user-selected entries.

---

## Workflow 3: Orphan Cleanup

Find and soft-delete entries with zero relationships.

### Steps

1. Retrieve orphaned statistics and entries:
   *Read and execute the Workflow 3 code block in [references/optimizer-scripts.md](references/optimizer-scripts.md).*
2. Present the orphan list. Flag any with `significance_type` set — these should NOT be deleted without explicit approval.
3. Execute the **Safe Deletion Protocol**.

> **Alternative to deletion**: For orphans that have value but lack connections, suggest using `link_entries` to connect them to related entries instead of deleting them.

---

## Workflow 4: Duplicate Detection

> **WARN: High tool-call budget** — This workflow executes an N×N semantic search loop. Limit the search set to 50 entries to avoid exhausting rate limits.

Find entries with semantically similar content that may be redundant.

### Steps

1. Identify candidate duplicates using semantic search:
   *Read and execute the Workflow 4 code block in [references/optimizer-scripts.md](references/optimizer-scripts.md).*
2. Present duplicate pairs side-by-side with recommendations.
3. Execute the **Safe Deletion Protocol** (targeting the lower-scoring entry of each pair).

> **Note**: Semantic search requires the vector index. If `get_vector_index_stats` shows zero indexed entries, suggest running `rebuild_vector_index` first.

---

## Workflow 5: Type-Based Cleanup

Clean up entries by `entry_type` — useful for removing bulk categories that were misclassified or have outlived their usefulness.

### Steps

1. Aggregate entry counts by type using `mj.analytics.getStatistics()`.
2. Present the type breakdown. Flag commonly low-value types (`personal_reflection`, `retrospective`, `note`).
3. User selects which types to target and an age threshold.
4. Preview matching entries:
   *Read and execute the Workflow 5 code block in [references/optimizer-scripts.md](references/optimizer-scripts.md).*
5. Execute the **Safe Deletion Protocol**.

---

## Revert Guide

Every workflow creates a backup before mutations. To revert:
*Follow the restoration commands in [references/optimizer-scripts.md](references/optimizer-scripts.md).*

> **Important**: Soft-deleted entries are physically present but excluded from queries. They are only permanently removed via `permanent: true`, restoring an old backup, or rebuilding from an export.

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
