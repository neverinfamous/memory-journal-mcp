/**
 * Field notes and gotchas — served via memory://help/gotchas resource.
 * Exported so the help resource handler can access it.
 *
 * NOTE: This file is inlined verbatim by scripts/generate-server-instructions.ts
 * into src/constants/server-instructions.ts, which already imports TOOL_GROUPS.
 * Do NOT add import statements here — they would appear as raw text in the output.
 */
export const GOTCHAS_CONTENT = `# memory-journal-mcp — Field Notes & Gotchas

## ⚠️ Critical Patterns

- **\`autoContext\`**: Deprecated in v7.5.1. The feature was originally planned for background filesystem monitoring but has been abandoned to reduce telemetry overhead. Existing data with \`autoContext: null\` is safely ignored.
- **\`memory://tags\` vs \`list_tags\`**: Resource includes \`id\`, \`name\`, \`count\`; tool returns only \`name\`, \`count\`. Neither returns orphan tags with zero usage.
- **Tag naming**: Use lowercase with dashes (e.g., \`bug-fix\`, \`phase-2\`). Use \`merge_tags\` to consolidate duplicates (e.g., merge \`phase2\` into \`phase-2\`).
- **\`merge_tags\` behavior**: Only updates non-deleted entries. Deleted entries retain their original tags.
- **\`prStatus\` in entries**: Reflects PR state at entry creation time, not current state. Use \`get_github_pr\` for live status.
- **\`restore_backup\` behavior**: Restores entire database state. Any recent changes (new entries, tag merges via \`merge_tags\`, relationships) are reverted. A pre-restore backup is automatically created for safety.

## Semantic Search

- **Indexing**: Entries are auto-indexed on creation (fire-and-forget). If index count drifts from DB count, use \`rebuild_vector_index\` or enable \`AUTO_REBUILD_INDEX=true\` for automatic reconciliation on server startup.
- **Related by ID**: Provide \`entry_id\` instead of a query string to find entries semantically related to an existing entry (reuses the existing embedding to avoid inference costs).
- **Metadata Filters**: Semantic search supports explicit filtering by \`tags\`, \`entry_type\`, \`start_date\`, and \`end_date\`.
- **Thresholds**: Default similarity threshold is 0.25. For broader matches, try 0.15-0.2. Higher values (0.4+) return only very close semantic matches. A quality floor of 0.5 is always enforced: if all results score below 0.5, a hint is included indicating results may be noise. The \`hint_on_empty\` flag (default true) only controls advisory hints for empty indexes and zero-match queries — the quality gate hint is always shown.

## Search

- **Hybrid Ranking**: \`search_entries\` defaults to \`mode: 'auto'\`. Conversational prompts automatically utilize Reciprocal Rank Fusion (true Hybrid) bridging keyword and vector algorithms.
- **\`search_entries\` FTS5 query syntax**: Uses FTS5 full-text search with Porter stemmer. Phrase queries: \`"error handling"\`. Prefix: \`auth*\`. Boolean: \`deploy OR release\`, \`error NOT warning\`. Word-boundary matching ("log" matches "log" but not "catalog"). Results ranked by BM25 relevance. Falls back to LIKE substring matching for queries with unbalanced quotes or special characters.

## Relationships & Analytics

- **Causal relationship types**: Use \`blocked_by\` (A was blocked by B), \`resolved\` (A resolved B), \`caused\` (A caused B) for decision tracing and failure analysis. Visualizations use distinct arrow styles for causal types.
- **Enhanced analytics**: \`get_statistics\` returns \`decisionDensity\` (significant entries per period), \`relationshipComplexity\` (avg relationships per entry), \`activityTrend\` (period-over-period growth %), and \`causalMetrics\` (counts for blocked_by/resolved/caused).
- **Importance scores**: \`get_entry_by_id\` returns \`importance\` (0.0-1.0) and \`importanceBreakdown\` showing weighted components: significance (30%), relationships (35%), causal (20%), recency (15%). \`memory://significant\` sorts entries by importance.
- **\`inactiveThresholdDays\`**: \`get_cross_project_insights\` includes \`inactiveThresholdDays: 7\` in output, documenting the inactive project classification cutoff.

## GitHub Metadata

- **GitHub metadata in entries**: Entry output includes 10 GitHub fields (\`issueNumber\`, \`issueUrl\`, \`prNumber\`, \`prUrl\`, \`prStatus\`, \`projectNumber\`, \`projectOwner\`, \`workflowRunId\`, \`workflowName\`, \`workflowStatus\`) in all tool responses.

## Entry Operations

- **\`delete_entry\` on soft-deleted**: \`delete_entry(id, permanent: true)\` works on previously soft-deleted entries. Returns \`success: false\` for nonexistent entries.

## Team Database

- **Team cross-database search**: \`search_entries\` and \`search_by_date_range\` automatically merge team DB results when \`TEAM_DB_PATH\` is configured. Results include a \`source\` field ("personal" or "team").
- **Team vector search**: Team has its own isolated vector index. Use \`team_rebuild_vector_index\` if the team index drifts. \`team_semantic_search\` works identically to personal \`semantic_search\`.
- **Team tools without \`TEAM_DB_PATH\`**: All 25 team tools return \`{ success: false, error: "Team collaboration is not configured..." }\` — no crash, no partial results.
`
