# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.1.0...HEAD)

### Added
- Bundled native foundational agent skills (`bun`, `golang`, `mysql`, `postgres`, `rust`, `shadcn-ui`, `sqlite`) for out-of-the-box system context
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
- `link_entries` tool ignoring soft-deleted state when creating new relationships
- Increased timeout in `tests/e2e/boundary.spec.ts` to accommodate vector index rebuild operations during CI execution

### Verified
- Validated all 67 standard MCP tools return `structuredContent` via automatically bounded payload output schemas
- Excluded Code Mode explicitly from `structuredContent` wrapper to prevent crash-inducing unconstrained schema parsing on client layers
- Verified Phase 10 Team Collaboration suite: 22 team tools and 2 team resources, ensuring safe DB isolation, accurate author attribution, and proper boundary conditions
- Verified Phase 12 Admin Tool Group operations including `update_entry`, `delete_entry`, `merge_tags`, and `add_to_vector_index` against deterministic structured error schemas (Zod mismatch, domain not found) with 100% token tracking
- Verified Backup & Export Tool Group (`backup_journal`, `restore_backup`, `export_entries`, `cleanup_backups`) enforcing path traversal restrictions, domain errors (`RESOURCE_NOT_FOUND`), strict filter bounding, and Zod parameter validation (`keep_count <= 0`).
