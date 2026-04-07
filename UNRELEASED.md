# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v6.3.0...HEAD)

### Added

- Playwright E2E observability testing for `/metrics` and `/audit` resources.
- Hybrid Reciprocal Rank Fusion (RRF), heuristic query classification, and exposed `searchMode` for `search_entries`.
- Dynamic Vitest coverage badge generation via `scripts/update-badges.ts`.
- Direct `entry_id` bypass and metadata filters for semantic search tools.
- Token estimation and `_meta.tokenEstimate` injection for context awareness.
- Async JSONL `AuditLogger` with rotating archives, configurable redaction, interceptor hooks, CLI flags, tail-read support, and observability resources (`memory://audit`, `memory://metrics/*`).
- Categorized placeholders in `.env.example` and `mcp-config-example.json`.

### Changed

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

- Interceptor schemas incorrectly failing with `-32602` validation errors.
- `callTool()` progress-token path bypassing interceptors.
- GitHub context data bleeding across shared helpers and faulty early returns in registries.
- GitHub cache fallback loop failing to resolve missing repository info in `issueUrl`.
- Missing error boundary parsing in CLI `PROJECT_REGISTRY` handlers.
- Base URI template parsing logic in `@modelcontextprotocol/sdk` converting `{repo}` to `{+repo}`.
- Omitted metadata filters (`tags`, `entry_type`, `start_date`, `end_date`) in `search_entries` FTS and Hybrid pipelines.
- Missing `entry_id` query support in `team_semantic_search`.
- `VectorSearchManager` caching a closed database connection, causing index rebuild failures.
- Silent database synchronization failure by correctly querying the `fts_content_docsize` shadow table.
- ISO 8601 payload generation formatting for GitHub milestones.
- Markdown rendering issues in agent instructions.
- Prioritization bug where server instructions overshadowed dynamic briefing resolution.
- Misleading `Could not detect repository` hint for multi-project users.
- Documentation mismatch regarding the 33 total resource count.
- GitHub CI badge workflow targets.
- Test suite stabilization fixes (Zod/Octokit errors, random string crashes, hardcoded positions, test script relative paths, mocking bugs, and parameter injection covering).

### Security

- Pinned `minimatch` to `10.2.5` to resolve transitive vulnerabilities.
- Updated container base image to `node:24.14.1-alpine`.
- Overrode `vite` to `^8.0.5` to patch path traversal vulnerabilities.
- Bumped CodeQL and TruffleHog GitHub Actions versions.
