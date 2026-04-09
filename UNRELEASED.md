# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.1.0...HEAD)

### Added

- Updated Code Mode API discoverability tests to accurately account for the `io` tool group addition
- Added `roadmap-kickoff` and `update-deps` workflows to the `github-commander` skills package.
- Added `docs/deployment.md` with comprehensive CI/CD deployment instructions and version bump checklist (migrated from copilot-mj-setup-instructions.md)
- `BRIEFING_MILESTONE_COUNT` and `--briefing-milestones` configuration for configuring `memory://briefing` milestone counts.
- `summary_only` and `item_limit` parameters for `get_kanban_board` — reduces token usage by up to 80% for large project boards
- `truncate_body` parameter for `get_github_issue` and `get_github_pr` — default 800 chars, set to 0 for full body
- `include_comments` parameter for `get_github_issue` — fetch issue comments on demand (default: off)
- `getIssueComments()` method in GitHub integration layer with caching
- `add_kanban_item` tool — directly attach GitHub issues to a GitHub project Kanban board via Node ID integration
- `delete_kanban_item` tool — cleanly remove issues/items from a GitHub project Kanban board without deleting the issue
- `CODE_MODE_MAX_RESULT_SIZE` env var and `--codemode-max-result-size` CLI flag for configurable Code Mode output cap
- Agent-guidance error messages for Code Mode result size violations (includes actual KB returned, field extraction example)
- `bodyTruncated`, `bodyFullLength` metadata in issue/PR detail output schemas
- `itemCount`, `truncated`, `summaryOnly` metadata in Kanban output schema
- Vitest tests for payload optimization: `result-size-cap`, `kanban-payload-optimization`, `github-body-truncation`, `max-query-limit` (32 new tests)

### Changed

- Gate `publish` job in `gatekeeper.yml` to tag pushes only (`startsWith(github.ref, 'refs/tags/v')`); squash-merge pushes to `main` now run lint/test/security checks only, eliminating the double pipeline run on every release
- Code Mode `maxResultSize` default reduced from 10 MB to 100 KB for context window protection (configurable via `CODE_MODE_MAX_RESULT_SIZE`)
- `MAX_QUERY_LIMIT` (500) enforced in `get_recent_entries`, `get_github_issues`, `get_github_prs` strict handler schemas (was already in search tools)
- Refactored `rulesResource`, `skillsResource`, and `scanSkillsDir` to use asynchronous `fs.promises` API to avoid blocking the Node event loop on polling
- Implemented `formatPromptEntries` truncation helper in GitHub prompts and `goal-tracker` prompt to prevent infinite `JSON.stringify` context allocation
- Added in-memory TTL caching (5 minutes) for the `memory://rules` resource using `fs.promises.stat` to verify timestamps

### Fixed

- Fixed missing `.min(1)` validation constraint on `limit` parameter in `TeamGetRecentSchema` and `GetRecentEntriesSchema` to correctly handle negative boundaries
- Fixed strict-boolean-expressions and no-explicit-any ESLint/TypeScript errors in prompt handlers
- Changed default sort direction in `getMilestones` to `desc` to correctly prioritize recent milestones in the `memory://briefing` summary
- Fixed cross-project context leakage in the `memory://briefing` resource by enforcing strict `projectNumber` bounding on Team and Journal summary queries
- Fixed `test-cm-crud.md` verification logic for computed fields (`importance`, `relationships`) to accurately mirror actual `mj_execute_code` response structures
- Fixed stale expectations in `test-core-infra.md`: template URI count (7→11), instruction token thresholds (~1.5K/~1.7K/~2.7K → ~1.9K/~2.2K/~3.3K), and tool annotation totals (61/16 → 67/22)

### Verified

- **Phase 3 (Text Search)**: Exhaustively tested direct MCP search operations including FTS5 operators (phrase, prefix, NOT, OR), fallback logic for `test's` and `100%`, hybrid RRF auto-mode, pure semantic mode, date ranges, and strict multi-parameter filters. All cases passed returning exactly expected payloads and cross-DB merge formats. No bugs detected.
