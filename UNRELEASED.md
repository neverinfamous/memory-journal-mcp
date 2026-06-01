# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added
- Added soft-delete recovery via new `restore_entry` and `team_restore_entry` tools.
- Added `list_deleted_entries` and `team_list_deleted_entries` tools for discovery of deleted entries prior to permanent deletion.
- Added archiving capabilities with an `is_archived` status to exclude historical entries from default search results.
- Added `include_archived` filter option to `search_entries`, `get_recent_entries`, `search_by_date_range` and their team equivalents.
- Added O(1) keyset cursor pagination to `get_recent_entries`, `search_entries`, `search_by_date_range`, and their team equivalents (via `cursor` parameter and `next_cursor` output).
- Updated server instructions, wiki documentation, and testing prompts to reflect new cursor pagination support and correct stale metrics.
- Added `batch_create_entries`, `batch_update_entries`, and `batch_delete_entries` tools to the admin group for bulk operations with vector indexing support.
- Added `team_batch_create_entries`, `team_batch_update_entries`, and `team_batch_delete_entries` tools to the team admin group.
- Added support for all batch operations via Code Mode API with method aliases.
- Added comprehensive test suite coverage (Standard & Code Mode) for all new bulk/batch operations.
- Added progress reporting to all batch tools for both standard and Code Mode execution.
- Added entry versioning/history tracking. Updates to entries now automatically save content snapshots (capped at 10 revisions per entry) in an `entry_revisions` table. Added a new `get_entry_history` tool to retrieve these snapshots.
- Added comprehensive testing coverage in `test-server/` prompts to verify history tracking functionality.
- Conducted a comprehensive documentation and file structure audit across the main repository and GitHub Wiki, syncing tool counts (84 tools total), resource counts (52 resources total: 46 core + 6 aliases), group presets, and capability metrics.
- Added and updated direct MCP and sandboxed Code Mode test prompts covering soft-delete recovery, archiving, and keyset cursor pagination.
- Added comprehensive standard and Code Mode test prompt coverage to verify dynamic `project_number` validation, server fallback resolution, and search boundary bypass rules for pure flag and entry-type queries.
- Added new Vitest unit and integration test suites covering soft-delete recovery, archiving filtering, keyset cursor-based pagination, and database-level version history/eviction limits.
- Added comprehensive Vitest unit and integration test coverage for team flag and search tools to assert dynamic `project_number` validation error paths, fallback resolution to server configuration defaults, and pure flag query search isolation bypasses.
- Added unified and consistent `project_number` validation and fallback resolution logic across all team and core tools, using workspace context mapping and configured default values prior to raising structured `VALIDATION_ERROR` responses.



### Fixed
- Fixed a ReferenceError crash in `batch_create_entries`, `batch_update_entries`, and `batch_delete_entries` (and their team variants) by properly importing the `sendProgress` utility.
- Fixed unit test regressions in batch tool handlers by correctly mocking vectorManager and injecting parameters.
- Fixed Docker Hub repository description not updating during tag-based deployments
- Fixed strict type safety and potential null runtime checks in semantic search and vector indexing handler routines.
- Fixed entry history/revision eviction policy logic to correctly preserve exactly the 10 newest revision snapshots using SQL `OFFSET 10`.
- Fixed restrictive update project number checks in team_update_entry and team_batch_update_entries to allow moving entries to a different project context during updates.
- Fixed error codes inside team search handlers to consistently return `VALIDATION_ERROR` instead of `PERMISSION_DENIED` when the `project_number` context is missing, satisfying the E2E contract isolation tests.
- Fixed missing `project_number` validation and default fallback resolution logic inside `team_pass_flag`, `team_list_flags`, and `team_get_flag_analytics` tool handlers to prevent multi-tenant context leakage.
