# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added
- Added `--prune-dry-run` flag and `PRUNE_DRY_RUN` configuration to preview auto-prune candidates without mutating the database.
- Added `--prune-exclude-tags` flag and `PRUNE_EXCLUDE_TAGS` configuration to exempt specific tags from being auto-pruned.
- Added resource read frequency tracking to observability stack (`memory://metrics/resources`, `memory://metrics/summary`).
- Added Prometheus metrics export via `/metrics` endpoint (`--metrics-export prometheus` flag or `METRICS_EXPORT` env var).
- Added per-tool latency percentile tracking (p50/p95/p99) via `memory://metrics/latency` resource.
- Added `mj-mcp-optimize` skill for debugging Code Mode execution pipeline.
- Added optimistic concurrency control for entry updates via `version` and `expected_version`.
- Added Team Role-Based Access Control (RBAC) supporting `admin`, `member`, and `viewer` roles.
- Added Team member management tools (`team_add_member`, `team_remove_member`, `team_update_member_role`, `team_list_members`, `team_get_member`).
- Added Team alias management tools (`team_add_author_alias`, `team_remove_author_alias`, `team_list_author_aliases`, `team_resolve_author`, `team_consolidate_authors`).
- Added `TEAM_DEFAULT_ROLE` environment variable to configure fallback role for unrecognized team authors.
- Added `TEAM_ADMIN` environment variable for headless RBAC bootstrapping.
- Added GitHub rate limit resource (`memory://github/rate-limit`) for proactive API throttling awareness.
- Added passive rate limit header capture from GitHub API responses.
- Added fuzzy search fallback for search queries (typo tolerance) using Levenshtein distance on entry tags and types.
- Added support for swappable vector embedding models (`--embedding-model` flag or `EMBEDDING_MODEL` env var).
- Added `cross_team_search` tool to perform read-only, FTS5-only searches across multiple team databases simultaneously.
- Added `--additional-team-dbs` CLI argument and `ADDITIONAL_TEAM_DBS` environment variable to configure dynamic sets of auxiliary team databases.
- Added `resources/subscribe` capability and real-time subscription manager for targeted notifications.
- Added support for returning FTS5 highlight snippets via `include_highlights` parameter in `search_entries` and `team_search`.
- Added faceted search capability via `include_facets` parameter in `search_entries` and `team_search`.
- Added dynamic weighting for hybrid searches via `fts_weight` and `semantic_weight` parameters in `search_entries` and `team_search`.
- Added explicit `mode` parameter (`auto`, `fts`, `semantic`, `hybrid`) to `search_entries` and `team_search` to control search strategy.
- Added database schema migration framework.
- Added composite and partial performance indexes for query optimization.
- Added soft-delete recovery via new `restore_entry` and `team_restore_entry` tools.
- Added `list_deleted_entries` and `team_list_deleted_entries` tools for discovery of deleted entries prior to permanent deletion.
- Added archiving capabilities with an `is_archived` status to exclude historical entries from default search results.
- Added `include_archived` filter option to `search_entries`, `get_recent_entries`, `search_by_date_range` and their team equivalents.
- Added O(1) keyset cursor pagination to `get_recent_entries`, `search_entries`, `search_by_date_range`, and their team equivalents.
- Added batch operation tools to the admin group (`batch_create_entries`, `batch_update_entries`, `batch_delete_entries`).
- Added team batch operation tools to the team admin group (`team_batch_create_entries`, `team_batch_update_entries`, `team_batch_delete_entries`).
- Added missing tool aliases (`team.delete`, `team.update`, `team.create`) to the Code Mode API.
- Added support for all batch operations via Code Mode API with method aliases.
- Added Code Mode fallback mapping for `listProjects` agent hallucinations to return project statistics.
- Added Code Mode method aliases (`searchProjects`, `listProjects`, `getProjects`) routed to `teamGetCrossProjectInsights`.
- Added safe `sleep(ms)` and `setTimeout` global aliases to the Code Mode VM sandbox.
- Added entry versioning/history tracking in an `entry_revisions` table and a new `get_entry_history` tool.
- Added `snake_case` to `camelCase` fallback mapping for Code Mode operations.

### Changed
- Synchronized tool count references from 95 to 96 across all documentation, test scripts, and GitHub Wiki files following the addition of the `search_audit_log` tool.
- Updated server instructions, wiki documentation, and testing prompts to reflect new cursor pagination support.
- Updated agent server instructions for Team RBAC and Optimistic Locking.
- Synchronized configuration templates (`.env.example`, `mcp-config-example.json`) and Wiki Configuration documentation with new Auto-Prune flags (`--prune-dry-run`, `--prune-exclude-tags`) and Observability metrics flags (`--persist-metrics`, `--metrics-path`).
- Migrated documentation and GitHub Actions workflows from `npm` to `pnpm`.

### Fixed
- Fixed generic `ReferenceError` for `fetch()` in Code Mode sandboxes by injecting a descriptive `SandboxNetworkError` interceptor.
- Fixed `cross_team_search` incorrectly omitting the primary team database when executing cross-database searches.
- Fixed FTS search phrase matching to preserve balanced double-quotes for exact phrase matches.
- Fixed `ReferenceError` crash in batch operations by importing `sendProgress`.
- Fixed Docker Hub repository description not updating during deployments.
- Fixed potential null runtime errors in semantic search and vector indexing.
- Fixed entry revision eviction logic to correctly preserve the 10 newest snapshots.
- Fixed restrictive `project_number` checks to allow moving team entries to different projects.
- Fixed error codes in team search handlers to consistently return `VALIDATION_ERROR` for missing `project_number`.
- Fixed missing `project_number` validation and fallback logic in team flag tools.
- Fixed team admin tools failing to check the `codemodeInternalFullAccess` configuration flag.
- Fixed Windows-specific race condition in `restoreFromFile` where lingering empty lock directories caused restores to abort.
- Fixed Zod schema validation error during hybrid search by correctly casting the internal `isArchived` flag.
- Fixed Code Mode execution errors for `read_query` alias by wrapping `searchEntries` and matching the `db-mcp` contract.
- Fixed Code Mode failures for `searchProjects` and `listProjects` aliases by mapping namespaces and returning native Arrays.
- Fixed Code Mode failures for `mj.core.getProjects` by mapping alias to `listProjects`.
- Fixed obsolete tool counts in documentation and configuration templates.
- Fixed validation error in `mj_execute_code` by making the `code` parameter optional.
- Fixed silent failure in Code Mode's `auto-return` transformation parsing of multiline template literals.
- Fixed validation error for string repository names in Code Mode `project_number` arguments by auto-resolving to numeric IDs.
- Fixed regression where batch database operations (`createEntries`, `updateEntries`, `deleteEntries`) were failing atomically. Migrated methods to process items individually and return structured `errors` arrays for partial successes.
- Fixed batch operation handlers (`batch_create_entries`, `batch_update_entries`, `batch_delete_entries`, and team equivalents) to aggregate partial failures using `AggregateMcpError`.
