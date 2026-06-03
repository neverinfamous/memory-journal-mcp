# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added
- Added optimistic concurrency control (conflict detection) for entry updates via a new `version` column and `expected_version` parameter. Agents trying to overwrite an entry concurrently will receive a structured `VERSION_CONFLICT` error with the current entry state instead of silently overwriting.
- Added a comprehensive Team Role-Based Access Control (RBAC) system for the shared team database, supporting `admin`, `member`, and `viewer` roles, with backward compatibility for existing uninitialized team databases.
- Added 5 new administrative member management tools (`team_add_member`, `team_remove_member`, `team_update_member_role`, `team_list_members`, `team_get_member`).
- Added `TEAM_DEFAULT_ROLE` environment variable (`--team-default-role`) to configure the fallback role for unrecognized team authors.
- Added `TEAM_ADMIN` environment variable (`--team-admin`) to support headless/Docker RBAC bootstrapping of the first admin.
- Added GitHub rate limit resource (`memory://github/rate-limit`) for proactive API throttling awareness.
- Added passive rate limit header capture from all GitHub API responses to provide real-time state without API cost.
- Added fuzzy search fallback for search queries (typo tolerance) using Levenshtein distance on entry tags and types.
- Added support for swappable vector embedding models via `--embedding-model` flag or `EMBEDDING_MODEL` environment variable. The database now dynamically tracks vector dimensions.

- Added support for returning FTS5 highlight snippets via `include_highlights` parameter in `search_entries` and `team_search`.
- Added faceted search capability via `include_facets` parameter in `search_entries` and `team_search`, returning tag and entry-type distribution counts.
- Added dynamic weighting for hybrid searches via `fts_weight` and `semantic_weight` parameters in `search_entries` and `team_search`.
- Added explicit `mode` parameter (`auto`, `fts`, `semantic`, `hybrid`) to `search_entries` and `team_search` to control search strategy.
- Added a versioned database schema migration framework under `src/database/migrations` (using sequential versioned migrations 001 to 007) and updated `NativeConnectionManager` to run migrations during initialization. Pre-existing databases are automatically retrofitted with a self-healing strategy.
- Added a comprehensive integration test suite `tests/database/migrations.test.ts` to assert fresh database migrations, team schema transitions, pre-migration retrofitting, and idempotency.
- Added composite and partial performance indexes to the database schema (`idx_memory_journal_active_timestamp`, `idx_memory_journal_active_recent`, `idx_memory_journal_type_timestamp`) to optimize active queries, default timestamp sorting, and entry-type filtering.
- Added soft-delete recovery via new `restore_entry` and `team_restore_entry` tools.
- Added `list_deleted_entries` and `team_list_deleted_entries` tools for discovery of deleted entries prior to permanent deletion.
- Added archiving capabilities with an `is_archived` status to exclude historical entries from default search results.
- Added `include_archived` filter option to `search_entries`, `get_recent_entries`, `search_by_date_range` and their team equivalents.
- Added O(1) keyset cursor pagination to `get_recent_entries`, `search_entries`, `search_by_date_range`, and their team equivalents (via `cursor` parameter and `next_cursor` output).
- Updated server instructions, wiki documentation, and testing prompts to reflect new cursor pagination support and correct stale metrics.
- Added `batch_create_entries`, `batch_update_entries`, and `batch_delete_entries` tools to the admin group for bulk operations with vector indexing support.
- Added `team_batch_create_entries`, `team_batch_update_entries`, and `team_batch_delete_entries` tools to the team admin group.
- Added missing tool aliases for the team group (`team.delete`, `team.update`, `team.create`) to the Code Mode API to prevent agent hallucination failures.
- Added support for all batch operations via Code Mode API with method aliases.
- Added a custom Code Mode mapping for `mj.listProjects()` and `mj.core.listProjects()` agent hallucinations that actually returns project statistics by returning the `PROJECT_REGISTRY` environment mapping or falling back to `mj.analytics.getStatistics({ project_breakdown: true })` instead of throwing an error.
- Added Code Mode method aliases (`searchProjects`, `listProjects`, `getProjects`) to the team group that gracefully route to `teamGetCrossProjectInsights` instead of throwing missing operation errors.
- Added safe `sleep(ms)` and capped `setTimeout` global aliases to the Code Mode VM sandbox to prevent common agent hallucinations from crashing execution.
- Added comprehensive test suite coverage (Standard & Code Mode) for all new bulk/batch operations.
- Added progress reporting to all batch tools for both standard and Code Mode execution.
- Added entry versioning/history tracking. Updates to entries now automatically save content snapshots (capped at 10 revisions per entry) in an `entry_revisions` table. Added a new `get_entry_history` tool to retrieve these snapshots.
- Added comprehensive testing coverage in `test-server/` prompts to verify history tracking functionality.
- Added and updated direct MCP and sandboxed Code Mode test prompts covering soft-delete recovery, archiving, and keyset cursor pagination.
- Added comprehensive standard and Code Mode test prompt coverage to verify dynamic `project_number` validation, server fallback resolution, and search boundary bypass rules for pure flag and entry-type queries.
- Added new Vitest unit and integration test suites covering soft-delete recovery, archiving filtering, keyset cursor-based pagination, and database-level version history/eviction limits.
- Added comprehensive Vitest unit and integration test coverage for team flag and search tools to assert dynamic `project_number` validation error paths, fallback resolution to server configuration defaults, and pure flag query search isolation bypasses.
- Added `test-team-rbac.md` and `test-cm-team-rbac.md` testing prompts to verify standard MCP and Code Mode execution of the new team member management tools.
- Added comprehensive Vitest unit testing suites (`rbac.test.ts` and `team-member-tools.test.ts`) covering the core RBAC access tier enforcement and team member tool handlers.
- Added unified and consistent `project_number` validation and fallback resolution logic across all team and core tools, using workspace context mapping and configured default values prior to raising structured `VALIDATION_ERROR` responses.
- Added Playwright E2E payload contract tests for the new History, Archiving, and Recovery tools to strictly enforce output schema boundaries.

### Fixed

- Fixed FTS search phrase matching by updating the query sanitizer to preserve balanced double-quotes for exact phrase matches, while still stripping malicious unbalanced quotes and operators.
- Fixed a ReferenceError crash in `batch_create_entries`, `batch_update_entries`, and `batch_delete_entries` (and their team variants) by properly importing the `sendProgress` utility.
- Fixed unit test regressions in batch tool handlers by correctly mocking vectorManager and injecting parameters.
- Fixed Docker Hub repository description not updating during tag-based deployments
- Fixed strict type safety and potential null runtime checks in semantic search and vector indexing handler routines.
- Fixed entry history/revision eviction policy logic to correctly preserve exactly the 10 newest revision snapshots using SQL `OFFSET 10`.
- Fixed restrictive update project number checks in team_update_entry and team_batch_update_entries to allow moving entries to a different project context during updates.
- Fixed error codes inside team search handlers to consistently return `VALIDATION_ERROR` instead of `PERMISSION_DENIED` when the `project_number` context is missing, satisfying the E2E contract isolation tests.
- Fixed missing `project_number` validation and default fallback resolution logic inside `team_pass_flag`, `team_list_flags`, and `team_get_flag_analytics` tool handlers to prevent multi-tenant context leakage.
- Fixed a bug where team admin tools (`team_delete_entry`, `team_update_entry`, `team_batch_update_entries`, `team_batch_delete_entries`) failed to check the `codemodeInternalFullAccess` configuration flag, correctly enabling Code Mode agents to bypass author permission constraints when configured.
- Fixed a Windows-specific race condition in `SqliteAdapter.restoreFromFile` where lingering empty lock directories caused subsequent restores to abort. The adapter now correctly detects orphaned lock directories with missing `lock.json` files as stale and safely overrides them.
- Fixed a Zod schema validation error during hybrid search execution by correctly casting the internal `isArchived` flag to a boolean value during batch database retrieval.
- Fixed Code Mode execution failures caused by common LLM hallucinations by mapping the `searchProjects` alias to the `core` and `search` namespaces, and by refactoring `listProjects` to explicitly return a native Array instead of an Object, correctly supporting iteration methods like `.find` through `isolated-vm` serialization boundaries.
- Fixed a test suite state pollution issue in the team flag extension tools on Windows by ensuring explicit removal of leftover `.db` files during `beforeAll` initialization.

### Changed

- Updated agent server instructions to reflect the new Team RBAC system and Optimistic Locking (`expected_version`) features.

- Migrated all primary documentation, configuration templates, GitHub Actions workflows, and AI instruction guides from `npm` to `pnpm` to establish `pnpm` as the single required package manager for internal development and deployment pipelines.
