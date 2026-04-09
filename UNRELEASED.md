# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.1.0...HEAD)

### Security / Verification

- Completed Phase 12 Data Integrity & Boundary verification sweep (zero data loss across 12+ mutation vectors)

### Added

- Bundled native foundational agent skills (`bun`, `github-commander`, `golang`, `mysql`, `playwright-standard`, `postgres`, `react-best-practices`, `rust`, `shadcn-ui`, `skill-builder`, `sqlite`, `typescript`, `vitest-standard`) for out-of-the-box system context
- `roadmap-kickoff` and `update-deps` workflows
- `docs/deployment.md` documentation
- `BRIEFING_MILESTONE_COUNT` environment variable and `--briefing-milestones` CLI flag
- `summary_only` and `item_limit` parameters for `get_kanban_board`
- `truncate_body` parameter for `get_github_issue` and `get_github_pr`
- `include_comments` parameter for `get_github_issue`
- `add_kanban_item` and `delete_kanban_item` tools for GitHub project boards
- "Latest Summary" field in `memory://briefing` payload to surface the most recent session summary
- `BRIEFING_SUMMARY_COUNT` environment variable and `--briefing-summaries` CLI flag for configuring multiple session summaries in the briefing resource
- `CODE_MODE_MAX_RESULT_SIZE` environment variable and `--codemode-max-result-size` CLI flag
- Agent-guidance error messages for Code Mode result size violations
- `bodyTruncated`, `bodyFullLength` metadata in issue/PR detail output schemas
- `itemCount`, `truncated`, `summaryOnly` metadata in Kanban output schema

### Changed

- Clarified token tracking in testing workflows to stipulate that tracked token counts should only reflect the estimated tokens that actually entered the context window
- Reduced Code Mode default max result size from 10 MB to 100 KB
- Enforced 500-item maximum limit in `get_recent_entries`, `get_github_issues`, and `get_github_prs`
- Refactored `rulesResource`, `skillsResource`, and `scanSkillsDir` to use asynchronous File System APIs
- Implemented payload truncation in GitHub prompts to prevent excessive context allocation
- Added in-memory TTL caching for GitHub issue comments and `memory://rules` resource
- Optimized CI `publish` workflow to run exclusively on tagged releases
- **Dependency Updates**
  - Updated `vitest` to `4.1.4`
  - Updated `@vitest/coverage-v8` to `4.1.4`

### Fixed

- Missing lower-bound validation constraint on `limit` parameters
- Strict-boolean-expressions and type checking warnings in prompt handlers
- Incorrect milestone sort direction in the `memory://briefing` reference
- Cross-project context leakage in `memory://briefing` query scoping
- Stale assertions in `test-cm-crud.md` and `test-core-infra.md` integration tests
- `link_entries` tool ignoring soft-deleted state when creating new relationships
- Increased timeout in `tests/e2e/boundary.spec.ts` to accommodate vector index rebuild operations during CI execution
- Empty parameter objects (`{}`) in `search_entries` erroneously bypassing validation, now returning structured `VALIDATION_ERROR`
- Code Mode `mj_execute_code` dynamically strips write operations when `readonly: true` is requested
