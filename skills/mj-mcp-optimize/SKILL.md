---
name: mj-mcp-optimize
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

| Group           | Required Tools                                              | Purpose                        |
| --------------- | ----------------------------------------------------------- | ------------------------------ |
| `admin`         | `delete_entry`, `update_entry`                              | Soft-delete entries            |
| `analytics`     | `get_statistics`                                            | Importance scores, graph stats |
| `search`        | `search_entries`, `search_by_date_range`, `semantic_search` | Find candidates                |
| `backup`        | `backup_journal`, `list_backups`, `restore_backup`          | Safety net                     |
| `codemode`      | `mj_execute_code`                                           | Batch operations               |
| `relationships` | `visualize_relationships`                                   | Orphan detection               |

If any required group is missing, inform the user and suggest adding it
via `--tool-filter` or `MEMORY_JOURNAL_MCP_TOOL_FILTER`.

## Importance Score Reference

The server computes importance scores (0.0–1.0) for every entry using
a weighted formula. Understanding this formula is essential for making
intelligent pruning decisions.

Read **[references/importance-scoring.md](references/importance-scoring.md)** for the full formula, component weights, and threshold guide.

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

## Code Mode & Bulk Modification Learnings

When executing advanced data enrichment or purging workflows (e.g., optimizing `test.db` for production migration):
- **Encrypted Database Access**: Direct filesystem operations via `better-sqlite3` on databases like `test.db` will fail with `SQLITE_NOTADB` because the files use `sqlcipher`. You **MUST** use the `mj_execute_code` Code Mode bridge to interact with the database within the server's running context.
- **Synchronous Timeout Constraints**: The Code Mode isolated VM enforces strict synchronous execution limits (typically ~30s). When performing massive bulk operations (e.g., soft-deleting 200+ test artifacts), chunk the operations into smaller limits (e.g., 150 entries per pass) and catch exceptions to prevent `Worker exited with code 1` timeout crashes.
- **External File Ingestion**: `mj_execute_code` runs in a sandbox and cannot execute `fs.readFileSync` to read external files (like `UNRELEASED.md` changelogs). To perform string matching or data ingestion, run an external script locally to parse the files, construct the specific payloads (e.g., mapped ID to SHA arrays), and then invoke `mj_execute_code` containing the precise, minimized dataset.

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
_Read and execute the Workflow 1 code block in [references/optimizer-scripts.md](references/optimizer-scripts.md)._

**Step 3 — Present results:**

Render the distribution as a table:

| Tier                 | Count | Action                                  |
| -------------------- | ----- | --------------------------------------- |
| Critical (≥0.50)     | N     | Keep — these are structural anchors     |
| High (0.30–0.49)     | N     | Keep — well-connected entries           |
| Moderate (0.15–0.29) | N     | Review individually if space is needed  |
| Low (0.01–0.14)      | N     | Candidates for cleanup with user review |
| Expendable (0.00)    | N     | Safe to soft-delete                     |

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
   _Read and execute the Workflow 3 code block in [references/optimizer-scripts.md](references/optimizer-scripts.md)._
2. Present the orphan list. Flag any with `significance_type` set — these should NOT be deleted without explicit approval.
3. Execute the **Safe Deletion Protocol**.

> **Alternative to deletion**: For orphans that have value but lack connections, suggest using `link_entries` to connect them to related entries instead of deleting them.

---

## Workflow 4: Duplicate Detection

> **WARN: High tool-call budget** — This workflow executes an N×N semantic search loop. Limit the search set to 50 entries to avoid exhausting rate limits.

Find entries with semantically similar content that may be redundant.

### Steps

1. Identify candidate duplicates using semantic search:
   _Read and execute the Workflow 4 code block in [references/optimizer-scripts.md](references/optimizer-scripts.md)._
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
   _Read and execute the Workflow 5 code block in [references/optimizer-scripts.md](references/optimizer-scripts.md)._
5. Execute the **Safe Deletion Protocol**.

---

## Workflow 6: Test Artifact Cleanup

Remove testing artifacts generated by Code Mode or API automation.

### Steps

1. Identify candidate test artifacts by matching test types and common strings.
2. Review the list (ensure actual retrospectives/fixes aren't accidentally included).
3. Execute the **Safe Deletion Protocol**:
   _Read and execute the Workflow 6 code block in [references/optimizer-scripts.md](references/optimizer-scripts.md)._

---

## Revert Guide

Every workflow creates a backup before mutations. To revert:
_Follow the restoration commands in [references/optimizer-scripts.md](references/optimizer-scripts.md)._

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
Complements `get_statistics`, `backup_journal`, and `rebuild_vector_index`.

## Scheduled Agent Integration

This skill supports autonomous execution via Antigravity's `/schedule` command.

- **Config:** [references/scheduled-config.json](references/scheduled-config.json) — runtime-tunable thresholds
- **Agent reference:** [references/scheduled-optimize-agent.md](references/scheduled-optimize-agent.md) — full execution guide
- **Automation Boundaries:** [references/automation-boundaries.md](references/automation-boundaries.md) — what is automated vs HITL
