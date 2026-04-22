# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.0...HEAD)

### Added
- Phase 28.4–28.9 Stability Verification for Team Admin & Collaboration via Code Mode:
  - Verified `team_update_entry`, `team_delete_entry`, and `team_merge_tags` correctly modify state with valid project context.
  - Verified `team_get_statistics` accurately returns entries by type, monthly rollups, and total counts.
  - Verified `team_link_entries` duplicate detection and relationships linking.
  - Verified `team_visualize_relationships` renders valid Mermaid graphs with accurate node/edge counts.
  - Verified `team_export_entries` and `team_export_markdown`/`team_import_markdown` properly manage IO boundaries and JSON/MD export parity.
  - Verified `team_backup` and `team_list_backups` correctly serialize and retrieve snapshot databases.
  - Verified `team_get_collaboration_matrix` efficiently returns cross-author telemetry via the Code Mode API bridge.
