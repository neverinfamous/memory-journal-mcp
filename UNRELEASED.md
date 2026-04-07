# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v6.3.0...HEAD)

### Added

- Playwright E2E observability testing for `/metrics` and `/audit` resources.
- Verified Phase 27 Code Mode Team Vector, Insights, and Cross-Tool Errors suite (18/18 error paths structured).
- Verified Phase 21 Code Mode Search & Semantics integration suite (16/16 tests passing).
- Hybrid Reciprocal Rank Fusion (RRF) and heuristic query classification to `search_entries`.
- Dynamic Vitest coverage badge generation via `scripts/update-badges.ts`.
- Direct `entry_id` bypass and metadata filters to `semantic_search`.
- Token estimation and `_meta.tokenEstimate` injection for context awareness.
- Async JSONL `AuditLogger` with rotating archives, configurable redaction, and `stderr` support.
- Audit interceptor to record all write and admin tool calls.
- Audit CLI flags (`--audit-log`, `--audit-redact`, `--audit-reads`, `--audit-log-max-size`).
- `AuditLogger.recent()` streaming tail-read capabilities.
- Observability MCP resources (`memory://audit`, `memory://metrics/*`).
- Exposed `searchMode` and fusion scoring on `EntriesListOutputSchema`.
- Categorized placeholders in `.env.example` and `mcp-config-example.json`.

### Changed

- Shifted `AuditLogger` from synchronous to async-buffered writes.
- Backed `memory://audit` resource with streamlined `AuditLogger.recent()`.
- Modularized `search.ts` into granular folder-based handlers.
- Reduced `DOCKER_README.md` size to comply with Docker Hub constraints.
- Refactored monolithic `.mjs` testing files into modular suites.
- Restructured `test-errors.md` into 7 granular domain checklists.
- Expanded CodeMode exception bounding in `suggestions.ts`.
- Updated dependencies including `typescript` 6.0.2, `@playwright/test` 1.59.1, and `eslint` 10.2.0.

### Removed

- Legacy `GITHUB_REPO_PATH` environment variable across the codebase in favor of `PROJECT_REGISTRY`.
- Experimental Copilot `dependency-maintenance` workflow, `auto-release` workflow, and related documentation.

### Fixed

- Zod and Octokit compiler diagnostic errors in the test suite.
- Support for missing `entry_id` queries in `team_semantic_search`.
- ISO 8601 payload generation formatting for GitHub milestones.
- Interceptor schemas incorrectly failing with `-32602` validation errors.
- GitHub context data bleeding across shared helpers.
- Faulty early returns blocking GitHub context processing in registries.
- Process crashes from noisy string generation in Code Mode testing.
- Hardcoded position assumptions in health test suites.
- Missing error boundary parsing in CLI `PROJECT_REGISTRY` handlers.
- Documentation mismatch regarding the 33 total resource count.
- GitHub CI badge workflow targets.
- Markdown rendering issues in agent instructions.
- Prioritization bug where server instructions overshadowed dynamic briefing resolution.
- Issue where `callTool()` progress-token path bypassed interceptors.
- GitHub cache fallback loop failing to actively resolve missing repository info in `issueUrl`.
- Misleading `Could not detect repository` hint to properly point multi-project users toward dynamic `{repo}` URIs.
- Relative path resolution for modularized test validation scripts.
- `VectorSearchManager` caching a closed database connection causing index rebuild failures.
- `VectorSearchManager` unit tests incorrectly bypassing database getters during mocking.
- Base URI template parsing logic inside `@modelcontextprotocol/sdk` improperly processing slashes by converting `{repo}` to `{+repo}`.
- Silent database synchronization failure by correctly querying the `fts_content_docsize` shadow table to detect missing FTS5 documents.
- Test suite parameter injection bugs in `search_entries` verification, unlocking stable 97%+ target line coverage.
- Omitted metadata filters (`tags`, `entry_type`, `start_date`, `end_date`) from `search_entries` FTS and Hybrid pipelines.

### Security

- Pinned `minimatch` to `10.2.5` to resolve transitive vulnerabilities.
- Updated container base image to `node:24.14.1-alpine`.
- Overrode `vite` to `^8.0.5` to patch path traversal vulnerabilities.
- Bumped CodeQL and TruffleHog GitHub Actions versions.
