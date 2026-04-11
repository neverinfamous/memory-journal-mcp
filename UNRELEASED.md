# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.3.0...HEAD)

### Added

- New agent skills: `python`, `docker`, `tailwind-css`, and `github-actions` (`neverinfamous-agent-skills` updated to `1.1.0`).
- `sort_by` parameter (`timestamp` or `importance`) for personal and team search tools.
- `team_get_collaboration_matrix` tool for analyzing author activity density and cross-collaboration patterns.
- Proactive Data Analytics tasks for background repository health snapshots (configured via `--digest-interval`).
- `memory://insights/digest` and `memory://insights/team-collaboration` resources for analytics snapshots.
- Injected analytics metrics into `memory://briefing` payloads.

### Fixed

- Missing `{ success: true }` wrapper on `team_get_cross_project_insights` payload.
- Output validation crash when calling `close_github_issue_with_entry` with `move_to_done: true` and no configured `project_number`.
- Missing `sortBy` delegation in text search and sorting logic during cross-database merges.
- Missing `mj.export.*` API documentation in Code Mode instructions.
- TypeScript (TS4111) and ESLint strict typing errors.
