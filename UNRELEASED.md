# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.1.0...HEAD)

### Added

- Bundled native foundational agent skills (`bun`, `github-commander`, `golang`, `mysql`, `playwright-standard`, `postgres`, `react-best-practices`, `rust`, `shadcn-ui`, `skill-builder`, `sqlite`, `typescript`, `vitest-standard`) for out-of-the-box system context
- `roadmap-kickoff` and `update-deps` workflows
- `docs/deployment.md` documentation
- `add_kanban_item` and `delete_kanban_item` tools for GitHub project boards
- Configuration variables (`BRIEFING_MILESTONE_COUNT`, `BRIEFING_SUMMARY_COUNT`, `CODE_MODE_MAX_RESULT_SIZE`) and their corresponding CLI flags
- `summary_only` and `item_limit` parameters for `get_kanban_board`
- `truncate_body` parameter for `get_github_issue` and `get_github_pr`
- `include_comments` parameter for `get_github_issue`
- `"Latest Summary"` field in `memory://briefing` to surface the most recent session summary
- Agent-guidance error messages for Code Mode result size violations
- Metadata fields `bodyTruncated`, `bodyFullLength` for GitHub issue/PR schemas, and `itemCount`, `truncated`, `summaryOnly` for Kanban output schemas

### Changed

- Reduced Code Mode default max result size from 10 MB to 100 KB
- Enforced a 500-item maximum limit in `get_recent_entries`, `get_github_issues`, and `get_github_prs`
- Implemented payload truncation in GitHub prompts to prevent excessive context allocation
- Added in-memory TTL caching for GitHub issue comments and `memory://rules` resource
- Refactored `rulesResource`, `skillsResource`, and `scanSkillsDir` to use asynchronous File System APIs
- Updated `@vitest/coverage-v8` and `vitest` dependency versions to `4.1.4`

### Fixed

- Missing lower-bound validation constraint on `limit` parameters
- Empty parameter objects (`{}`) in `search_entries` bypassing validation, now correctly returning structured `VALIDATION_ERROR`
- Code Mode `mj_execute_code` failing to block write operations when `readonly` is requested
- `link_entries` ignoring soft-deleted state when creating new relationships
- Cross-project context leakage in `memory://briefing` query scoping
- Incorrect milestone sort direction in the `memory://briefing` reference
