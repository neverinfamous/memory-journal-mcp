# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.3.0...HEAD)

### Added

- `python` skill: Modern Python engineering — `uv`, `ruff`, type hints, `pytest`, Pydantic v2, `src/` layout, and async patterns.
- `docker` skill: Production-grade Docker — multi-stage builds, BuildKit, non-root users, secret mounts, Compose v2, and CI/CD integration.
- `tailwind-css` skill: Tailwind CSS v4 — CSS-first `@theme` configuration, `@custom-variant` dark mode, responsive design, animations, and v3 migration.
- `github-actions` skill: GitHub Actions CI/CD — SHA pinning, permission hardening, caching, matrix strategies, reusable workflows, and artifacts v4.
- Bumped `neverinfamous-agent-skills` package from `1.0.8` → `1.1.0` for expanded skill catalog (15 → 19 skills).
- `sort_by` parameter (`'timestamp'` | `'importance'`) to core and team search tools.
- `importanceScore` metadata field in search results when importance sorting is active.
- Post-fetch fallback importance sorting for semantic and hybrid searches.
- `team_get_collaboration_matrix` tool to analyze author activity density and cross-collaboration patterns.
- Proactive Data Analytics tasks for automated background repository health snapshotting.
- `memory://insights/digest` and `memory://insights/team-collaboration` resources for analytics snapshots.
- `--digest-interval` CLI argument to specify snapshot generation frequency.
- Injected analytics metrics (`relationshipDensity`, `activityTrend`, `significanceSpike`) into `memory://briefing` payloads.

### Fixed

- `team_get_cross_project_insights` returning insight payloads without the standard `{ success: true }` wrapper, which violated output schema standards and normalization expectations.
- `CloseGitHubIssueWithEntryOutputSchema`: `kanban.projectNumber` was required (`z.number()`) but omitted when no project is configured, causing output validation crash (`-32602`) when calling `close_github_issue_with_entry` with `move_to_done: true` and no `project_number`. Made `.optional()` and added missing `error` field to match handler output.
- Missing `sortBy` forwarding to underlying fetches during `ftsSearch()` delegations, and fixed `mergeAndDedup` to correctly sort by `importanceScore` across database merges.
- Fixed TS4111 index signature access error for `importanceScore` in `helpers.ts` during string sorting operations.
- Strict typing and ESLint caching errors regarding filter limits and significance metric validations.
- Missing `export` tool group namespace (`mj.export.*`) in the Code Mode instruction documentation table, ensuring all 10 API discoverability groups are correctly documented for LLM context.
