# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.0...HEAD)

### Added
- Completed Phase 26 / 27 stability verification for Admin, Backup, & Export tools via Code Mode API.
  - Verified tag management (`listTags`, `mergeTags`) including success and failure boundaries.
  - Verified backup and restore lifecycle (`backupJournal`, `listBackups`, `restoreBackup`, `cleanupBackups`), including path traversal blocking.
