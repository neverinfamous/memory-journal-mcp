# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added
- Added `batch_create_entries`, `batch_update_entries`, and `batch_delete_entries` tools to the admin group for bulk operations with vector indexing support.
- Added `team_batch_create_entries`, `team_batch_update_entries`, and `team_batch_delete_entries` tools to the team admin group.
- Added support for all batch operations via Code Mode API with method aliases.
- Added comprehensive test suite coverage (Standard & Code Mode) for all new bulk/batch operations.

### Fixed
- Fixed a ReferenceError crash in `batch_create_entries`, `batch_update_entries`, and `batch_delete_entries` (and their team variants) by properly importing the `sendProgress` utility.
- Fixed Docker Hub repository description not updating during tag-based deployments
