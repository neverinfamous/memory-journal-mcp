# Unreleased Changes

## [Unreleased]

### Added

- Playwright E2E spec (`tests/e2e/payloads-observability.spec.ts`) covering all 5 Phase 2 resources (`memory://metrics/*`, `memory://audit`), `_meta.tokenEstimate` injection on tool responses, and the `memory://health` metrics subsection.
- Hybrid Reciprocal Rank Fusion (RRF) search combining FTS5 and vector similarity scoring to `search_entries`.
- Heuristic query classification (`auto`, `fts`, `semantic`, `hybrid`) via `mode` parameter in `search_entries`.
- Find-related execution bypass via `entry_id` lookup in `semantic_search`.
- Robust metadata filters (`tags`, `entry_type`, `start_date`, `end_date`) in `semantic_search`.
- Byte-length token estimation (`estimateTokens`, `injectTokenEstimate`) for agent context-window awareness via `_meta.tokenEstimate`.
- In-memory `MetricsAccumulator` and interception logging.
- Enterprise JSONL `AuditLogger` with 10 MB rotating file archives and configurable argument redaction.
- Audit interceptor wiring all write/admin tool calls to the JSONL audit trail with scope-based filtering, token estimation, and duration timing.
- CLI flags `--audit-log`, `--audit-redact`, `--audit-reads`, `--audit-log-max-size` and matching `AUDIT_LOG_PATH`, `AUDIT_REDACT`, `AUDIT_READS`, `AUDIT_LOG_MAX_SIZE` environment variables.
- stderr audit mode (`--audit-log stderr`) for containerised deployments.
- Configurable read-scope auditing via `--audit-reads` flag.
- `AuditLogger.recent()` streaming tail-read (64KB window) for O(1) audit resource access.
- Graceful `AuditLogger.close()` lifecycle for clean shutdown flush.
- Session summary (token totals, error count, duration) in the `memory://audit` resource.
- 5 observability and audit MCP resources (`memory://metrics/*`, `memory://audit`).
- Aggregate call, error, and token counts in the `memory://health` metrics section.
- `searchMode` and fusion scoring exposure on `EntriesListOutputSchema`.
- `.env.example` with all environment variables grouped by category for local development setup.
- `PROJECT_REGISTRY` and `TEAM_DB_PATH` placeholders to `mcp-config-example.json`.

### Changed

- Refactored `AuditLogger` from synchronous `appendFileSync` to async-buffered writes (50-entry high-water mark, 100ms auto-flush) for non-blocking audit I/O.
- Refactored `memory://audit` resource to use `AuditLogger.recent()` instead of full-file I/O.
- Modified `AuditConfig` handling to replace `NullAuditLogger` with `enabled: false` config flag and explicitly typed fields.
- Refactored `search.ts` handler into dedicated `/src/handlers/tools/search/` modules.
- Updated asynchronous `callTool()` processing to inject token estimates.
- Consolidated dependency updates: `@huggingface/transformers` to `4.0.1`, `typescript` to `6.0.2`, `@playwright/test` to `1.59.1`, `@types/node` to `25.5.2`, `esbuild` to `0.28.0`, `eslint` to `10.2.0`, and `simple-git` to `3.35.2`.
- Reduced `DOCKER_README.md` length to conform with Docker Hub 25,000-character limit.
- Refactored monolithic core and Code Mode test files into granular, independently-runnable modules to reduce token strain.
- Relocated standalone testing `.mjs` scripts into `test-server/scripts/`.
- Updated test documentation and handler maps to reflect new modular test structure.
- Refactored legacy `test-errors.md` and `test-integrity.md` files into 7 granular domain checklists (`test-tool-group-*.md`) to enforce strict Structured Error Response coverage per-tool.
- Expanded `src/utils/errors/suggestions.ts` fuzzy pattern mapping to automatically catch and refine CodeMode exceptions and SQLite malformed-input boundaries.
- Verified Phase 27 `codemode` Team API mapping (CRUD, tagging, and search operations) via `mj.team.*` under high-volume mock iterations.

### Fixed

- GitHub API payload generation bug in `create_github_milestone` and `update_github_milestone` causing failures when processing full ISO 8601 strings.
- Interceptor schemas failing with `-32602` validation errors by bypassing strict output checks.
- Shared context data bleeding in GitHub integration helpers.
- Faulty early returns blocking project registry execution when GitHub context is uninitialized.
- Process crashes from noisy string generation in Code Mode OOM tests.
- Hardcoded position assumptions in health resource test suites by shifting to explicit lookups.
- Missing error boundary parsing in CLI `PROJECT_REGISTRY` payload handlers.
- Documentation drift matching the 28 to 33 resource count update.
- CI badges correctly targeting `gatekeeper.yml`.
- Render issues with markdown checklists in agent instructions.
- Prioritization of dynamic briefing resolution in server instruction loading.
- `callTool()` progress-token path bypassing both metrics and audit interceptors for raw handler invocations.

### Security

- Pinned `minimatch` to `10.2.5` across dependencies and overrides to combat transitive vulnerabilities.
- Updated Dockerfile base image to `node:24.14.1-alpine` to fix underlying CVEs.
- Fixed `vite` path traversal and arbitrary file read vulnerabilities by overriding with `^8.0.5`.
- Bumped `github/codeql-action` to `v4.35.1` and `trufflesecurity/trufflehog` to `v3.94.2` to resolve static analysis and supply chain security alerts.
