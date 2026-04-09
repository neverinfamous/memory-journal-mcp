# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.1.0...HEAD)

### Added
- `roadmap-kickoff` and `update-deps` workflows
- `docs/deployment.md` documentation
- `BRIEFING_MILESTONE_COUNT` environment variable and `--briefing-milestones` CLI flag
- `summary_only` and `item_limit` parameters for `get_kanban_board`
- `truncate_body` parameter for `get_github_issue` and `get_github_pr`
- `include_comments` parameter for `get_github_issue`
- `add_kanban_item` and `delete_kanban_item` tools for GitHub project boards
- "Latest Summary" field in `memory://briefing` payload to surface the most recent session summary
- `CODE_MODE_MAX_RESULT_SIZE` environment variable and `--codemode-max-result-size` CLI flag
- Agent-guidance error messages for Code Mode result size violations
- `bodyTruncated`, `bodyFullLength` metadata in issue/PR detail output schemas
- `itemCount`, `truncated`, `summaryOnly` metadata in Kanban output schema

### Changed
- Reduced Code Mode default max result size from 10 MB to 100 KB
- Enforced 500-item maximum limit in `get_recent_entries`, `get_github_issues`, and `get_github_prs`
- Refactored `rulesResource`, `skillsResource`, and `scanSkillsDir` to use asynchronous File System APIs
- Implemented payload truncation in GitHub prompts to prevent excessive context allocation
- Added in-memory TTL caching for GitHub issue comments and `memory://rules` resource
- Optimized CI `publish` workflow to run exclusively on tagged releases

### Fixed
- Missing lower-bound validation constraint on `limit` parameters
- Strict-boolean-expressions and type checking warnings in prompt handlers
- Incorrect milestone sort direction in the `memory://briefing` reference
- Cross-project context leakage in `memory://briefing` query scoping
- Stale assertions in `test-cm-crud.md` and `test-core-infra.md` integration tests
