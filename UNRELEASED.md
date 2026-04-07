# Unreleased Changes

## [Unreleased]

### Added

- Playwright E2E observability testing for `/metrics` and `/audit` resources.
- Hybrid Reciprocal Rank Fusion (RRF) and heuristic query classification to `search_entries`.
- Direct `entry_id` bypass and metadata filters to `semantic_search`.
- Token estimation and `_meta.tokenEstimate` injection for context awareness.
- Async JSONL `AuditLogger` with rotating archives, configurable redaction, and `stderr` support.
- Audit interceptor to record all write/admin tool calls.
- Audit CLI flags (`--audit-log`, `--audit-redact`, `--audit-reads`, `--audit-log-max-size`).
- `AuditLogger.recent()` streaming tail-read capabilities.
- Observability MCP resources (`memory://audit`, `memory://metrics/*`).
- Exposed `searchMode` and fusion scoring on `EntriesListOutputSchema`.
- Categorized `.env.example` and `mcp-config-example.json` placeholders.

### Changed

- Deprecated and removed the legacy `GITHUB_REPO_PATH` environment variable across the entire codebase to favor `PROJECT_REGISTRY`.
- Implemented intelligent `PROJECT_REGISTRY` fallback prioritizing the first configured registry project for static GitHub resource URIs (e.g. `memory://github/status`).
- Transitioned `AuditLogger` from synchronous to async-buffered writes.
- Backed `memory://audit` resource with streamlined `AuditLogger.recent()` implementation.
- Modularized `search.ts` into granular folder-based handlers.
- Reduced `DOCKER_README.md` to comply with Docker Hub size constraints.
- Refactored monolithic testing files and standalone `.mjs` scripts into modular suites.
- Restructured `test-errors.md` into 7 granular domain checklists.
- Expanded `suggestions.ts` pattern mapping for CodeMode exception bounding.
- Updated dependencies (`typescript` 6.0.2, `@playwright/test` 1.59.1, `eslint` 10.2.0, etc.).

### Fixed

- Remedied persistent Zod and Octokit compiler diagnostic errors in the test suite to achieve 100% clean check status.
- Support for missing `entry_id` queries in `team_semantic_search`.
- GitHub API ISO 8601 payload generation for milestones.
- Interceptor schemas failing with `-32602` validation errors.
- Github context data bleeding across shared helpers.
- Faulty early returns blocking GitHub context processing in registries.
- Process crashes from noisy string generation in Code Mode memory tests.
- Hardcoded position assumptions in health test suites.
- Missing error boundary parsing in CLI `PROJECT_REGISTRY` handlers.
- Documentation mismatch reflecting correct 33 resource count.
- Directed CI badges to correct GitHub workflows.
- Markdown rendering issues in agent instructions.
- Prioritization of dynamic briefing resolution over server instructions.
- `callTool()` progress-token path bypassing interceptors.
- Fixed `issueUrl` resolution fallback in `resolveIssueUrl` to actively fetch repository info if missing from cache.
- Improved `Could not detect repository` hint to point multi-project users toward dynamic `{repo}` URIs.
- Fixed relative path resolution for modularized test validation scripts.
- Fixed `VectorSearchManager` caching a closed database connection, preventing `The database connection is not open` errors during index rebuilds after a backup is restored.
- Refactored `VectorSearchManager` unit tests to correctly mock the constructor injection `IDatabaseAdapter` instead of incorrectly bypassing the `db` getter with `Object.assign()`.
- Updated base URI template parsing logic for `@modelcontextprotocol/sdk` to correctly process path segments containing slashes by switching `{repo}` templates to `{+repo}`.

### Security

- Pinned `minimatch` to `10.2.5` to combat transitive vulnerabilities.
- Updated container base image to `node:24.14.1-alpine`.
- Overrode `vite` to `^8.0.5` to address path traversal vulnerabilities.
- Bumped CodeQL and TruffleHog GitHub Actions versions.
