# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added
- Added O(1) keyset cursor pagination to `get_recent_entries`, `search_entries`, `search_by_date_range`, and their team equivalents (via `cursor` parameter and `next_cursor` output).
- Updated server instructions, wiki documentation, and testing prompts to reflect new cursor pagination support and correct stale metrics.
- Added `batch_create_entries`, `batch_update_entries`, and `batch_delete_entries` tools to the admin group for bulk operations with vector indexing support.
- Added `team_batch_create_entries`, `team_batch_update_entries`, and `team_batch_delete_entries` tools to the team admin group.
- Added support for all batch operations via Code Mode API with method aliases.
- Added comprehensive test suite coverage (Standard & Code Mode) for all new bulk/batch operations.
- Added progress reporting to all batch tools for both standard and Code Mode execution.
- Added entry versioning/history tracking. Updates to entries now automatically save content snapshots (capped at 10 revisions per entry) in an `entry_revisions` table. Added a new `get_entry_history` tool to retrieve these snapshots.
- Added comprehensive testing coverage in `test-server/` prompts to verify history tracking functionality.

### Fixed
- Fixed a ReferenceError crash in `batch_create_entries`, `batch_update_entries`, and `batch_delete_entries` (and their team variants) by properly importing the `sendProgress` utility.
- Fixed unit test regressions in batch tool handlers by correctly mocking vectorManager and injecting parameters.
- Fixed Docker Hub repository description not updating during tag-based deployments
