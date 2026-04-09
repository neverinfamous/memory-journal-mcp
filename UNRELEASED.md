# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.1.0...HEAD)

### Added

- `BRIEFING_MILESTONE_COUNT` and `--briefing-milestones` configuration for configuring `memory://briefing` milestone counts.
- `summary_only` and `item_limit` parameters for `get_kanban_board` — reduces token usage by up to 80% for large project boards
- `truncate_body` parameter for `get_github_issue` and `get_github_pr` — default 800 chars, set to 0 for full body
- `include_comments` parameter for `get_github_issue` — fetch issue comments on demand (default: off)
- `getIssueComments()` method in GitHub integration layer with caching
- `CODE_MODE_MAX_RESULT_SIZE` env var and `--codemode-max-result-size` CLI flag for configurable Code Mode output cap
- Agent-guidance error messages for Code Mode result size violations (includes actual KB returned, field extraction example)
- `bodyTruncated`, `bodyFullLength` metadata in issue/PR detail output schemas
- `itemCount`, `truncated`, `summaryOnly` metadata in Kanban output schema
- Vitest tests for payload optimization: `result-size-cap`, `kanban-payload-optimization`, `github-body-truncation`, `max-query-limit` (32 new tests)

### Changed

- Gate `publish` job in `gatekeeper.yml` to tag pushes only (`startsWith(github.ref, 'refs/tags/v')`); squash-merge pushes to `main` now run lint/test/security checks only, eliminating the double pipeline run on every release
- Code Mode `maxResultSize` default reduced from 10 MB to 100 KB for context window protection (configurable via `CODE_MODE_MAX_RESULT_SIZE`)
- `MAX_QUERY_LIMIT` (500) enforced in `get_recent_entries`, `get_github_issues`, `get_github_prs` strict handler schemas (was already in search tools)
